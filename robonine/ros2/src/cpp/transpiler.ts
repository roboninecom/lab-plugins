import type { Node as TSNode, Parser } from 'web-tree-sitter'

// Translates a curated subset of rclcpp-style C++ into async JavaScript that
// runs against the __rt runtime (rclcppRuntime.ts). The subset covers the
// idioms of educational ROS2 nodes: a class deriving from rclcpp::Node,
// publishers/subscriptions/wall timers, std::bind and lambdas, chrono
// literals, std::vector, RCLCPP_* logging macros and a classic main().
// Anything outside the subset produces a line-anchored TranspileIssue instead
// of silently wrong code.

export interface TranspileIssue {
  line: number
  message: string
}

export class TranspileError extends Error {
  issues: TranspileIssue[]

  constructor(issues: TranspileIssue[]) {
    super(issues.map((issue) => `line ${issue.line}: ${issue.message}`).join('\n'))
    this.name = 'TranspileError'
    this.issues = issues
  }
}

interface ClassInfo {
  name: string
  extendsNode: boolean
  baseClass: string | null
  fields: Set<string>
  methods: Set<string>
}

interface EmitContext {
  currentClass: ClassInfo | null
  asyncOk: boolean
}

const MSG_NAMESPACES = new Set(['std_msgs', 'sensor_msgs', 'geometry_msgs', 'builtin_interfaces'])

const MATH_FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sqrt',
  'pow',
  'floor',
  'ceil',
  'round',
  'exp',
  'log',
  'log2',
  'log10',
  'abs',
  'fabs',
  'fmin',
  'fmax',
  'hypot',
  'cbrt',
  'trunc',
])

const MATH_NAME_MAP: Record<string, string> = {
  abs: 'abs',
  fabs: 'abs',
  fmin: 'min',
  fmax: 'max',
  min: 'min',
  max: 'max',
}

const LOG_MACROS: Record<string, string> = {
  RCLCPP_DEBUG: 'debug',
  RCLCPP_INFO: 'info',
  RCLCPP_WARN: 'warn',
  RCLCPP_ERROR: 'error',
  RCLCPP_FATAL: 'error',
}

const LOG_STREAM_MACROS: Record<string, string> = {
  RCLCPP_DEBUG_STREAM: 'debug',
  RCLCPP_INFO_STREAM: 'info',
  RCLCPP_WARN_STREAM: 'warn',
  RCLCPP_ERROR_STREAM: 'error',
  RCLCPP_FATAL_STREAM: 'error',
}

const UDL_SUFFIX_TO_MS: Record<string, number> = { ns: 1e-6, us: 1e-3, ms: 1, s: 1000, min: 60000 }
const NODE_METHODS = new Set(['create_publisher', 'create_subscription', 'create_wall_timer', 'create_timer', 'get_logger', 'declare_parameter', 'get_parameter', 'get_name', 'get_clock', 'now'])

function normalize(text: string): string {
  return text.replace(/\s+/g, '')
}

function msgTypeToken(typeText: string): string | null {
  const parts = normalize(typeText)
    .replace(/::(SharedPtr|ConstSharedPtr|UniquePtr)$/, '')
    .split('::')

  if (parts.length === 3 && parts[1] === 'msg' && MSG_NAMESPACES.has(parts[0])) {
    return `${parts[0]}/msg/${parts[2]}`
  }

  return null
}

class Scope {
  private stack: Array<Set<string>> = [new Set()]

  push(): void {
    this.stack.push(new Set())
  }

  pop(): void {
    this.stack.pop()
  }

  declare(name: string): void {
    this.stack[this.stack.length - 1].add(name)
  }

  has(name: string): boolean {
    return this.stack.some((level) => level.has(name))
  }
}

export function transpileCpp(parser: Parser, source: string): string {
  const tree = parser.parse(source)
  const issues: TranspileIssue[] = []
  const classes = new Map<string, ClassInfo>()
  const globalFunctions = new Set<string>()
  const scope = new Scope()
  const chunks: string[] = []

  if (!tree) {
    throw new TranspileError([{ line: 1, message: 'Failed to parse the program.' }])
  }

  function fail(node: TSNode, message: string): string {
    issues.push({ line: node.startPosition.row + 1, message })

    return 'undefined'
  }

  function named(node: TSNode): TSNode[] {
    return node.namedChildren.filter((child): child is TSNode => child !== null && child.type !== 'comment')
  }

  function field(node: TSNode | null, name: string): TSNode | null {
    return node ? node.childForFieldName(name) : null
  }

  // ── Pass 1: collect classes and global functions ──────────────────────────

  function declaratorName(node: TSNode | null): string | null {
    let current = node

    while (current) {
      if (current.type === 'identifier' || current.type === 'field_identifier' || current.type === 'type_identifier' || current.type === 'destructor_name') {
        return current.text
      }
      if (current.type === 'qualified_identifier') {
        current = field(current, 'name')
        continue
      }
      if (
        current.type === 'function_declarator' ||
        current.type === 'pointer_declarator' ||
        current.type === 'reference_declarator' ||
        current.type === 'array_declarator' ||
        current.type === 'parenthesized_declarator' ||
        current.type === 'init_declarator'
      ) {
        current = field(current, 'declarator') ?? named(current)[0] ?? null
        continue
      }

      return null
    }

    return null
  }

  function collectClass(node: TSNode): void {
    const nameNode = field(node, 'name')
    const bodyNode = field(node, 'body')

    if (!nameNode || !bodyNode) {
      return
    }

    const info: ClassInfo = {
      name: nameNode.text,
      extendsNode: false,
      baseClass: null,
      fields: new Set(),
      methods: new Set(),
    }

    for (const child of node.children) {
      if (child?.type === 'base_class_clause') {
        const baseText = normalize(child.text)

        if (baseText.includes('rclcpp::Node')) {
          info.extendsNode = true
        } else {
          const match = baseText.match(/(?:public|private|protected)?([A-Za-z_][A-Za-z0-9_]*)$/)

          info.baseClass = match ? match[1] : null
        }
      }
    }

    for (const member of named(bodyNode)) {
      if (member.type === 'field_declaration') {
        for (const declarator of named(member)) {
          if (declarator.type === 'field_identifier') {
            info.fields.add(declarator.text)
          } else if (declarator.type === 'init_declarator' || declarator.type === 'pointer_declarator' || declarator.type === 'reference_declarator' || declarator.type === 'array_declarator') {
            const name = declaratorName(declarator)

            if (name) {
              info.fields.add(name)
            }
          }
        }
      } else if (member.type === 'function_definition') {
        const name = declaratorName(field(member, 'declarator'))

        if (name && name !== info.name) {
          info.methods.add(name)
        }
      }
    }
    classes.set(info.name, info)
  }

  for (const top of named(tree.rootNode)) {
    if (top.type === 'class_specifier' || top.type === 'struct_specifier') {
      collectClass(top)
    } else if (top.type === 'function_definition') {
      const name = declaratorName(field(top, 'declarator'))

      if (name && !name.includes('::')) {
        globalFunctions.add(name)
      }
    }
  }

  // ── Expressions ────────────────────────────────────────────────────────────

  function awaited(call: string, ctx: EmitContext): string {
    return ctx.asyncOk ? `(await ${call})` : call
  }

  function emitArgs(argsNode: TSNode | null, ctx: EmitContext): string[] {
    if (!argsNode) {
      return []
    }

    return named(argsNode).map((arg) => expr(arg, ctx))
  }

  function flattenStream(node: TSNode, ctx: EmitContext): string[] {
    const text = normalize(node.text)

    if (node.type === 'binary_expression') {
      const opNode = node.children.find((child) => child && !child.isNamed && child.type === '<<')

      if (opNode) {
        const left = field(node, 'left')
        const right = field(node, 'right')

        if (left && right) {
          return [...flattenStream(left, ctx), ...flattenStream(right, ctx)]
        }
      }
    }

    if (text === 'std::endl' || text === 'endl') {
      return ["'\\n'"]
    }
    if (text === 'std::cout' || text === 'std::cerr' || text === 'cout' || text === 'cerr') {
      return []
    }

    return [expr(node, ctx)]
  }

  function emitBind(node: TSNode, argsNode: TSNode | null, ctx: EmitContext): string {
    const args = argsNode ? named(argsNode) : []

    if (args.length < 2) {
      return fail(node, 'std::bind needs a member function and an object.')
    }

    const methodName = declaratorName(args[0]) ?? args[0].text.split('::').pop() ?? ''
    const target = normalize(args[1].text) === 'this' ? 'this' : expr(args[1], ctx)

    for (const extra of args.slice(2)) {
      if (!/^(std::placeholders::)?_\d+$/.test(normalize(extra.text))) {
        return fail(extra, 'std::bind supports only std::placeholders arguments here.')
      }
    }

    return `${target}.${methodName.replace(/^&/, '')}.bind(${target})`
  }

  function emitKnownCall(node: TSNode, fnName: string, templateArg: string | null, argsNode: TSNode | null, ctx: EmitContext): string | null {
    // std::bind arguments (&Class::method, placeholders) must not go through
    // the generic expression emitter.
    const args = emitArgs(argsNode, ctx)
    const bareMath = fnName.replace(/^std::/, '')
    const token = msgTypeToken(fnName)

    if (fnName === 'std::bind') {
      return emitBind(node, argsNode, ctx)
    }

    switch (fnName) {
      case 'std::make_shared': {
        const token = msgTypeToken(templateArg ?? '')

        if (!templateArg) {
          return fail(node, 'std::make_shared needs a template argument.')
        }

        if (token) {
          return `__rt.newMsg('${token}')`
        }
        if (classes.has(normalize(templateArg))) {
          return `new ${normalize(templateArg)}(${args.join(', ')})`
        }

        return fail(node, `Unknown type in std::make_shared: ${templateArg}`)
      }
      case 'rclcpp::init':
        return '__rt.init()'
      case 'rclcpp::shutdown':
        return '__rt.shutdown()'
      case 'rclcpp::ok':
        return '__rt.ok()'
      case 'rclcpp::spin':
        return ctx.asyncOk ? `(await __rt.spin(${args.join(', ')}))` : fail(node, 'rclcpp::spin cannot be used in a constructor.')
      case 'rclcpp::spin_some':
        return ctx.asyncOk ? `(await __rt.spinSome(${args.join(', ')}))` : fail(node, 'rclcpp::spin_some cannot be used in a constructor.')
      case 'rclcpp::QoS':
        return `(${args[0] ?? '10'})`
      case 'rclcpp::Rate':
        return `new __rt.Rate(${args.join(', ')})`
      case 'std::this_thread::sleep_for':
        return ctx.asyncOk ? `(await __rt.sleep(${args[0] ?? '0'}))` : fail(node, 'sleep_for cannot be used in a constructor.')
      case 'std::chrono::milliseconds':
        return `(${args[0] ?? '0'})`
      case 'std::chrono::seconds':
        return `((${args[0] ?? '0'}) * 1000)`
      case 'std::chrono::duration':
        return `((${args[0] ?? '0'}) * 1000)`
      case 'std::to_string':
        return `String(${args[0] ?? "''"})`
      case 'std::stod':
      case 'std::stof':
        return `parseFloat(${args[0] ?? '0'})`
      case 'std::stoi':
        return `parseInt(${args[0] ?? '0'}, 10)`
      case 'std::clamp':
        return `Math.min(Math.max(${args[0]}, ${args[1]}), ${args[2]})`
      case 'std::min':
        return `Math.min(${args.join(', ')})`
      case 'std::max':
        return `Math.max(${args.join(', ')})`
      case 'static_cast':
      case 'dynamic_cast':
      case 'const_cast':
      case 'reinterpret_cast':
        return `(${args[0] ?? 'undefined'})`
      case 'printf':
        return `__rt.printf(${args.join(', ')})`
      default:
        break
    }

    if (fnName in LOG_MACROS) {
      const level = LOG_MACROS[fnName]
      const rest = args.slice(1)

      return `__rt.logf(${args[0] ?? 'null'}, '${level}', ${rest.length > 0 ? rest.join(', ') : "''"})`
    }
    if (fnName in LOG_STREAM_MACROS && argsNode) {
      const level = LOG_STREAM_MACROS[fnName]
      const streamArgs = named(argsNode)
      const parts = streamArgs.slice(1).flatMap((part) => flattenStream(part, ctx))

      return `__rt.logStream(${args[0] ?? 'null'}, '${level}', [${parts.join(', ')}])`
    }

    if (MATH_FUNCTIONS.has(bareMath)) {
      return `Math.${MATH_NAME_MAP[bareMath] ?? bareMath}(${args.join(', ')})`
    }

    if (token) {
      return `__rt.newMsg('${token}')`
    }

    return null
  }

  function templateParts(fnNode: TSNode): { name: string; templateArg: string | null } {
    if (fnNode.type === 'template_function' || fnNode.type === 'template_method' || fnNode.type === 'template_type') {
      const nameNode = field(fnNode, 'name')
      const argsNode = field(fnNode, 'arguments')

      const inner = argsNode
        ? named(argsNode)
            .map((argument) => argument.text)
            .join(',')
        : null

      return { name: nameNode ? nameNode.text : fnNode.text, templateArg: inner }
    }
    if (fnNode.type === 'qualified_identifier') {
      const full = normalize(fnNode.text)
      const match = full.match(/^([^<]+)<(.+)>$/)

      if (match) {
        return { name: match[1], templateArg: match[2] }
      }

      return { name: full, templateArg: null }
    }

    return { name: normalize(fnNode.text), templateArg: null }
  }

  function emitNodeFactoryCall(base: string, method: string, templateArg: string | null, argsNode: TSNode | null, node: TSNode, ctx: EmitContext): string | null {
    const token = templateArg ? msgTypeToken(templateArg) : null
    const args = emitArgs(argsNode, ctx)

    if (method !== 'create_publisher' && method !== 'create_subscription') {
      return null
    }

    if (!token) {
      return fail(node, `${method} needs a message type template argument like <std_msgs::msg::Float64MultiArray>.`)
    }

    return `${base}.${method}('${token}', ${args.join(', ')})`
  }

  function emitMethodCall(fnNode: TSNode, argsNode: TSNode | null, node: TSNode, ctx: EmitContext): string {
    const objectNode = field(fnNode, 'argument')
    const fieldNode = field(fnNode, 'field')
    const args = emitArgs(argsNode, ctx)

    if (!objectNode || !fieldNode) {
      return fail(node, 'Unsupported method call.')
    }

    const base = expr(objectNode, ctx)
    const { name: method, templateArg } = templateParts(fieldNode)
    const factory = emitNodeFactoryCall(base, method, templateArg, argsNode, node, ctx)

    if (factory) {
      return factory
    }

    switch (method) {
      case 'push_back':
      case 'emplace_back':
        return `${base}.push(${args.join(', ')})`
      case 'pop_back':
        return `${base}.pop()`
      case 'at':
        return `${base}[${args[0] ?? '0'}]`
      case 'size':
      case 'length':
        return `${base}.length`
      case 'empty':
        return `(${base}.length === 0)`
      case 'clear':
        return `(${base}.length = 0)`
      case 'front':
        return `${base}[0]`
      case 'back':
        return `${base}[${base}.length - 1]`
      case 'c_str':
      case 'data':
        return base
      case 'reserve':
      case 'shrink_to_fit':
        return '(void 0)'
      case 'reset':
        return `(${base} = null)`
      case 'sleep':
        return ctx.asyncOk ? `(await ${base}.sleep())` : `${base}.sleep()`
      default:
        return awaited(`${base}.${method}(${args.join(', ')})`, ctx)
    }
  }

  function emitCall(node: TSNode, ctx: EmitContext): string {
    const fnNode = field(node, 'function')
    const argsNode = field(node, 'arguments')

    if (!fnNode) {
      return fail(node, 'Unsupported call.')
    }

    if (fnNode.type === 'field_expression') {
      return emitMethodCall(fnNode, argsNode, node, ctx)
    }

    const { name, templateArg } = templateParts(fnNode)
    const known = emitKnownCall(node, name, templateArg, argsNode, ctx)

    if (known !== null) {
      return known
    }

    const args = emitArgs(argsNode, ctx)

    if (ctx.currentClass && (ctx.currentClass.methods.has(name) || NODE_METHODS.has(name)) && !scope.has(name)) {
      const factory = emitNodeFactoryCall('this', name, templateArg, argsNode, node, ctx)

      if (factory) {
        return factory
      }

      return awaited(`this.${name}(${args.join(', ')})`, ctx)
    }
    if (classes.has(name)) {
      return `new ${name}(${args.join(', ')})`
    }
    if (globalFunctions.has(name) || scope.has(name)) {
      return awaited(`${name}(${args.join(', ')})`, ctx)
    }
    if (name.includes('::')) {
      return fail(node, `Unsupported C++ call: ${name}. This browser runtime covers the rclcpp basics used in the lessons.`)
    }

    return fail(node, `Unknown function '${name}'.`)
  }

  function emitIdentifier(node: TSNode, ctx: EmitContext): string {
    const name = node.text

    if (scope.has(name)) {
      return name
    }
    if (ctx.currentClass && ctx.currentClass.fields.has(name)) {
      return `this.${name}`
    }
    if (ctx.currentClass && ctx.currentClass.methods.has(name)) {
      return `this.${name}`
    }
    if (name === 'M_PI') {
      return 'Math.PI'
    }

    return name
  }

  function emitUserDefinedLiteral(node: TSNode): string {
    const match = node.text.match(/^([0-9.]+(?:e[+-]?\d+)?)([a-zA-Z_]+)$/)

    if (!match) {
      return fail(node, `Unsupported literal: ${node.text}`)
    }

    const factor = UDL_SUFFIX_TO_MS[match[2]]

    if (factor === undefined) {
      return fail(node, `Unsupported duration suffix '${match[2]}' (use ns, us, ms, s or min).`)
    }

    return String(parseFloat(match[1]) * factor)
  }

  function expr(node: TSNode, ctx: EmitContext): string {
    switch (node.type) {
      case 'identifier':
        return emitIdentifier(node, ctx)
      case 'field_identifier':
        return node.text
      case 'this':
        return 'this'
      case 'number_literal':
        return node.text.replace(/[fFlLuU']+$/, '')
      case 'user_defined_literal':
        return emitUserDefinedLiteral(node)
      case 'string_literal':
      case 'raw_string_literal':
      case 'char_literal':
        return node.text
      case 'concatenated_string':
        return named(node)
          .map((part) => part.text)
          .join(' + ')
      case 'true':
        return 'true'
      case 'false':
        return 'false'
      case 'nullptr':
      case 'null':
        return 'null'
      case 'call_expression':
        return emitCall(node, ctx)
      case 'field_expression': {
        const objectNode = field(node, 'argument')
        const fieldNode = field(node, 'field')

        if (!objectNode || !fieldNode) {
          return fail(node, 'Unsupported field access.')
        }

        return `${expr(objectNode, ctx)}.${fieldNode.text}`
      }
      case 'qualified_identifier': {
        const text = normalize(node.text)

        if (text === 'std::endl') {
          return "'\\n'"
        }
        if (/^(std::placeholders::)?_\d+$/.test(text)) {
          return 'undefined'
        }
        if (text === 'M_PI' || text === 'std::numbers::pi') {
          return 'Math.PI'
        }

        const token = msgTypeToken(text)

        if (token) {
          return `__rt.msgClass('${token}')`
        }

        const methodMatch = text.match(/^([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)$/)

        if (methodMatch && classes.has(methodMatch[1])) {
          return `${methodMatch[1]}.prototype.${methodMatch[2]}`
        }

        return fail(node, `Unsupported qualified name: ${node.text}`)
      }
      case 'binary_expression': {
        const left = field(node, 'left')
        const right = field(node, 'right')
        const operator = field(node, 'operator')?.text ?? node.children.find((child) => child && !child.isNamed)?.text

        if (!left || !right || !operator) {
          return fail(node, 'Unsupported expression.')
        }
        if (operator === '<<') {
          const parts = flattenStream(node, ctx)

          return `__rt.cout([${parts.join(', ')}])`
        }

        return `(${expr(left, ctx)} ${operator} ${expr(right, ctx)})`
      }
      case 'unary_expression': {
        const argument = field(node, 'argument')
        const operator = field(node, 'operator')?.text ?? '!'

        return argument ? `(${operator}${expr(argument, ctx)})` : fail(node, 'Unsupported expression.')
      }
      case 'update_expression': {
        const argument = field(node, 'argument')
        const operator = node.children.find((child) => child && !child.isNamed && (child.type === '++' || child.type === '--'))?.text ?? '++'

        if (!argument) {
          return fail(node, 'Unsupported expression.')
        }

        return node.text.startsWith(operator) ? `(${operator}${expr(argument, ctx)})` : `(${expr(argument, ctx)}${operator})`
      }
      case 'assignment_expression': {
        const left = field(node, 'left')
        const right = field(node, 'right')
        const operator = field(node, 'operator')?.text ?? node.children.find((child) => child && !child.isNamed)?.text ?? '='

        if (!left || !right) {
          return fail(node, 'Unsupported assignment.')
        }

        return `${expr(left, ctx)} ${operator} ${expr(right, ctx)}`
      }
      case 'conditional_expression': {
        const condition = field(node, 'condition')
        const consequence = field(node, 'consequence')
        const alternative = field(node, 'alternative')

        if (!condition || !consequence || !alternative) {
          return fail(node, 'Unsupported conditional.')
        }

        return `(${expr(condition, ctx)} ? ${expr(consequence, ctx)} : ${expr(alternative, ctx)})`
      }
      case 'parenthesized_expression': {
        const inner = named(node)[0]

        return inner ? `(${expr(inner, ctx)})` : '()'
      }
      case 'subscript_expression': {
        const argument = field(node, 'argument')
        const indices = field(node, 'indices') ?? named(node)[1]

        if (!argument || !indices) {
          return fail(node, 'Unsupported subscript.')
        }

        const indexNode = indices.type === 'subscript_argument_list' ? named(indices)[0] : indices

        return `${expr(argument, ctx)}[${indexNode ? expr(indexNode, ctx) : '0'}]`
      }
      case 'pointer_expression': {
        const argument = field(node, 'argument')

        return argument ? expr(argument, ctx) : fail(node, 'Unsupported expression.')
      }
      case 'initializer_list':
        return `[${named(node)
          .map((item) => expr(item, ctx))
          .join(', ')}]`
      case 'lambda_expression': {
        const declarator = field(node, 'declarator')
        const body = field(node, 'body')
        const params: string[] = []

        scope.push()
        if (declarator) {
          const paramsNode = field(declarator, 'parameters')

          if (paramsNode) {
            for (const param of named(paramsNode)) {
              const paramName = declaratorName(field(param, 'declarator') ?? param)

              if (paramName) {
                params.push(paramName)
                scope.declare(paramName)
              }
            }
          }
        }

        const bodyCode = body ? emitBlock(body, ctx, '  ') : '{}'

        scope.pop()

        return `async (${params.join(', ')}) => ${bodyCode}`
      }
      case 'cast_expression': {
        const value = field(node, 'value')

        return value ? `(${expr(value, ctx)})` : fail(node, 'Unsupported cast.')
      }
      case 'comma_expression': {
        const children = named(node)

        return `(${children.map((child) => expr(child, ctx)).join(', ')})`
      }
      default:
        return fail(node, `Unsupported C++ construct: ${node.type}`)
    }
  }

  // ── Statements ────────────────────────────────────────────────────────────

  function defaultForType(typeText: string): string {
    const flat = normalize(typeText)

    if (flat.includes('vector') || flat.includes('array')) {
      return '[]'
    }
    if (flat.includes('string')) {
      return "''"
    }
    if (flat.includes('bool')) {
      return 'false'
    }
    if (flat.includes('SharedPtr') || flat.includes('Ptr') || flat.includes('*')) {
      return 'null'
    }

    const token = msgTypeToken(flat)

    if (token) {
      return `__rt.newMsg('${token}')`
    }

    return '0'
  }

  function emitDeclarationCore(node: TSNode, ctx: EmitContext): string {
    const typeNode = field(node, 'type')
    const typeText = typeNode ? typeNode.text : 'auto'
    const parts: string[] = []

    for (const child of named(node)) {
      if (child === typeNode) {
        continue
      }
      if (child.type === 'init_declarator') {
        const name = declaratorName(field(child, 'declarator'))
        const valueNode = field(child, 'value')

        if (!name) {
          fail(child, 'Unsupported declaration.')
          continue
        }
        scope.declare(name)
        if (valueNode) {
          if (valueNode.type === 'argument_list') {
            const args = emitArgs(valueNode, ctx)

            if (normalize(typeText).includes('vector') && args.length === 2) {
              parts.push(`${name} = Array(${args[0]}).fill(${args[1]})`)
            } else if (classes.has(normalize(typeText))) {
              parts.push(`${name} = new ${normalize(typeText)}(${args.join(', ')})`)
            } else if (args.length === 1) {
              parts.push(`${name} = ${args[0]}`)
            } else {
              parts.push(`${name} = [${args.join(', ')}]`)
            }
          } else {
            parts.push(`${name} = ${expr(valueNode, ctx)}`)
          }
        } else {
          parts.push(`${name} = ${defaultForType(typeText)}`)
        }
      } else if (child.type === 'identifier' || child.type === 'pointer_declarator' || child.type === 'reference_declarator' || child.type === 'array_declarator') {
        const name = declaratorName(child)

        if (name) {
          scope.declare(name)
          parts.push(`${name} = ${defaultForType(typeText)}`)
        }
      } else if (child.type === 'function_declarator') {
        fail(child, 'Function declarations inside functions are not supported.')
      }
    }

    return parts.length > 0 ? `let ${parts.join(', ')}` : ''
  }

  function conditionOf(node: TSNode, ctx: EmitContext): string {
    const conditionNode = field(node, 'condition')

    if (!conditionNode) {
      return 'true'
    }

    const valueNode = field(conditionNode, 'value') ?? named(conditionNode)[0]

    return valueNode ? expr(valueNode, ctx) : 'true'
  }

  function tick(ctx: EmitContext, indent: string): string {
    return ctx.asyncOk ? `${indent}  await __rt.tick();\n` : ''
  }

  function emitBlock(node: TSNode, ctx: EmitContext, indent: string): string {
    const lines: string[] = []

    scope.push()
    for (const statement of named(node)) {
      const code = stmt(statement, ctx, `${indent}  `)

      if (code) {
        lines.push(code)
      }
    }
    scope.pop()

    return `{\n${lines.join('\n')}\n${indent}}`
  }

  function bodyOrStatement(node: TSNode | null, ctx: EmitContext, indent: string, loopTick: boolean): string {
    if (!node) {
      return '{}'
    }
    if (node.type === 'compound_statement') {
      const block = emitBlock(node, ctx, indent)

      if (loopTick) {
        return block.replace('{\n', `{\n${tick(ctx, indent)}`)
      }

      return block
    }

    return `{\n${loopTick ? tick(ctx, indent) : ''}${stmt(node, ctx, `${indent}  `)}\n${indent}}`
  }

  function stmt(node: TSNode, ctx: EmitContext, indent: string): string {
    switch (node.type) {
      case 'compound_statement':
        return `${indent}${emitBlock(node, ctx, indent)}`
      case 'declaration': {
        const core = emitDeclarationCore(node, ctx)

        return core ? `${indent}${core};` : ''
      }
      case 'expression_statement': {
        const inner = named(node)[0]

        return inner ? `${indent}${expr(inner, ctx)};` : ''
      }
      case 'return_statement': {
        const value = named(node)[0]

        return value ? `${indent}return ${expr(value, ctx)};` : `${indent}return;`
      }
      case 'if_statement': {
        const consequence = field(node, 'consequence')
        const alternative = field(node, 'alternative')
        let code = `${indent}if (${conditionOf(node, ctx)}) ${bodyOrStatement(consequence, ctx, indent, false)}`

        if (alternative) {
          const elseBody = named(alternative)[0] ?? null

          if (elseBody && elseBody.type === 'if_statement') {
            code += ` else ${stmt(elseBody, ctx, indent).trimStart()}`
          } else {
            code += ` else ${bodyOrStatement(elseBody, ctx, indent, false)}`
          }
        }

        return code
      }
      case 'while_statement':
        return `${indent}while (${conditionOf(node, ctx)}) ${bodyOrStatement(field(node, 'body'), ctx, indent, true)}`
      case 'for_statement': {
        const initializerNode = field(node, 'initializer')
        const conditionNode = field(node, 'condition')
        const updateNode = field(node, 'update')
        let initializer = ''
        const body = bodyOrStatement(field(node, 'body'), ctx, indent, true)

        scope.push()

        if (initializerNode) {
          initializer = initializerNode.type === 'declaration' ? emitDeclarationCore(initializerNode, ctx) : expr(initializerNode, ctx)
        }

        const condition = conditionNode ? expr(conditionNode, ctx) : ''
        const update = updateNode ? expr(updateNode, ctx) : ''

        scope.pop()

        return `${indent}for (${initializer}; ${condition}; ${update}) ${body}`
      }
      case 'for_range_loop': {
        const name = declaratorName(field(node, 'declarator')) ?? 'item'
        const rightNode = field(node, 'right')
        const body = bodyOrStatement(field(node, 'body'), ctx, indent, true)

        scope.push()

        scope.declare(name)

        const iterable = rightNode ? expr(rightNode, ctx) : '[]'

        scope.pop()

        return `${indent}for (const ${name} of ${iterable}) ${body}`
      }
      case 'break_statement':
        return `${indent}break;`
      case 'continue_statement':
        return `${indent}continue;`
      case 'try_statement': {
        const body = field(node, 'body')
        const catchClauses = named(node).filter((child) => child.type === 'catch_clause')
        let code = `${indent}try ${body ? emitBlock(body, ctx, indent) : '{}'}`

        if (catchClauses.length > 0) {
          const catchBody = field(catchClauses[0], 'body')
          const paramsNode = field(catchClauses[0], 'parameters')
          const caughtName = paramsNode ? (declaratorName(named(paramsNode)[0] ?? null) ?? 'err') : 'err'

          scope.push()
          scope.declare(caughtName)
          code += ` catch (${caughtName}) ${catchBody ? emitBlock(catchBody, ctx, indent) : '{}'}`
          scope.pop()
        } else {
          code += ' catch {}'
        }

        return code
      }
      case 'throw_statement': {
        const value = named(node)[0]

        return `${indent}throw new Error(String(${value ? expr(value, ctx) : "'error'"}));`
      }
      case 'labeled_statement':
        return fail(node, 'Labels are not supported.')
      case 'switch_statement':
        return fail(node, 'switch statements are not supported yet — use if/else.')
      case 'using_declaration':
      case 'alias_declaration':
      case 'preproc_include':
      case 'preproc_def':
      case 'preproc_call':
      case 'preproc_function_def':
        return ''
      default:
        return `${indent}${expr(node, ctx)};`
    }
  }

  // ── Functions and classes ─────────────────────────────────────────────────

  function paramNames(fnDeclarator: TSNode | null): string[] {
    const names: string[] = []
    const paramsNode = field(fnDeclarator, 'parameters')

    if (!paramsNode) {
      return names
    }
    for (const param of named(paramsNode)) {
      if (param.type === 'parameter_declaration' || param.type === 'optional_parameter_declaration') {
        const name = declaratorName(field(param, 'declarator') ?? param)

        if (name) {
          names.push(name)
        }
      }
    }

    return names
  }

  function findFunctionDeclarator(node: TSNode): TSNode | null {
    let current = field(node, 'declarator')

    while (current && current.type !== 'function_declarator') {
      current = field(current, 'declarator') ?? named(current)[0] ?? null
    }

    return current
  }

  function emitConstructor(classInfo: ClassInfo, ctorNode: TSNode | null, fieldDefaults: string[], indent: string): string {
    const ctx: EmitContext = { currentClass: classInfo, asyncOk: false }
    const params: string[] = []
    const superArgs: string[] = []
    const memberInits: string[] = []
    let body = ''
    const lines: string[] = []

    scope.push()
    if (ctorNode) {
      const declarator = findFunctionDeclarator(ctorNode)
      const bodyNode = field(ctorNode, 'body')

      for (const name of paramNames(declarator)) {
        params.push(name)
        scope.declare(name)
      }
      for (const child of named(ctorNode)) {
        if (child.type === 'field_initializer_list') {
          for (const init of named(child)) {
            const nameNode = named(init)[0]
            const argsNode = named(init).find((candidate) => candidate.type === 'argument_list' || candidate.type === 'initializer_list')
            const args = argsNode ? (argsNode.type === 'initializer_list' ? [expr(argsNode, ctx)] : emitArgs(argsNode, ctx)) : []

            if (!nameNode) {
              continue
            }
            if (normalize(nameNode.text) === 'Node' || normalize(nameNode.text).endsWith('::Node') || nameNode.text === classInfo.baseClass) {
              superArgs.push(...args)
            } else {
              memberInits.push(`this.${nameNode.text} = ${args[0] ?? '0'}`)
            }
          }
        }
      }

      if (bodyNode) {
        body = named(bodyNode)
          .map((statement) => stmt(statement, ctx, `${indent}    `))
          .filter(Boolean)
          .join('\n')
      }
    }
    scope.pop()

    if (classInfo.extendsNode || classInfo.baseClass) {
      lines.push(`${indent}    super(${superArgs.join(', ')});`)
    }
    for (const fieldDefault of fieldDefaults) {
      lines.push(`${indent}    ${fieldDefault};`)
    }
    for (const memberInit of memberInits) {
      lines.push(`${indent}    ${memberInit};`)
    }
    if (body) {
      lines.push(body)
    }

    return `${indent}  constructor(${params.join(', ')}) {\n${lines.join('\n')}\n${indent}  }`
  }

  function emitClass(node: TSNode): string {
    const nameNode = field(node, 'name')
    const bodyNode = field(node, 'body')
    const fieldDefaults: string[] = []
    const methods: string[] = []
    let ctorNode: TSNode | null = null

    if (!nameNode || !bodyNode) {
      return fail(node, 'Unsupported class definition.')
    }

    const classInfo = classes.get(nameNode.text)

    if (!classInfo) {
      return fail(node, 'Unsupported class definition.')
    }

    const ctx: EmitContext = { currentClass: classInfo, asyncOk: true }

    for (const member of named(bodyNode)) {
      if (member.type === 'field_declaration') {
        const typeNode = field(member, 'type')
        const defaultValueNode = field(member, 'default_value')
        const typeText = typeNode ? typeNode.text : 'auto'

        for (const declarator of named(member)) {
          if (declarator === typeNode || declarator === defaultValueNode) {
            continue
          }
          if (declarator.type === 'field_identifier') {
            const initial = defaultValueNode ? expr(defaultValueNode, { currentClass: classInfo, asyncOk: false }) : defaultForType(typeText)

            fieldDefaults.push(`this.${declarator.text} = ${initial}`)
          } else if (declarator.type === 'init_declarator') {
            const name = declaratorName(field(declarator, 'declarator'))
            const valueNode = field(declarator, 'value')

            if (name) {
              scope.push()
              fieldDefaults.push(`this.${name} = ${valueNode ? expr(valueNode, { currentClass: classInfo, asyncOk: false }) : defaultForType(typeText)}`)
              scope.pop()
            }
          } else if (declarator.type === 'pointer_declarator' || declarator.type === 'reference_declarator' || declarator.type === 'array_declarator') {
            const name = declaratorName(declarator)

            if (name) {
              fieldDefaults.push(`this.${name} = ${defaultForType(typeText)}`)
            }
          }
        }
      } else if (member.type === 'function_definition') {
        const methodName = declaratorName(field(member, 'declarator'))

        if (methodName === classInfo.name) {
          ctorNode = member
        } else if (methodName && methodName.startsWith('~')) {
          // Destructors are not needed in the browser runtime.
        } else if (methodName) {
          const declarator = findFunctionDeclarator(member)
          const methodBody = field(member, 'body')

          scope.push()

          const params = paramNames(declarator)

          for (const param of params) {
            scope.declare(param)
          }
          methods.push(`  async ${methodName}(${params.join(', ')}) ${methodBody ? emitBlock(methodBody, ctx, '  ') : '{}'}`)
          scope.pop()
        }
      }
    }

    const heritage = classInfo.extendsNode ? ' extends __rt.Node' : classInfo.baseClass ? ` extends ${classInfo.baseClass}` : ''
    const ctor = emitConstructor(classInfo, ctorNode, fieldDefaults, '')

    return `class ${classInfo.name}${heritage} {\n${ctor}\n${methods.join('\n')}\n}`
  }

  function emitFunction(node: TSNode): string {
    const name = declaratorName(field(node, 'declarator'))
    const declarator = findFunctionDeclarator(node)
    const bodyNode = field(node, 'body')
    const ctx: EmitContext = { currentClass: null, asyncOk: true }

    if (!name || !bodyNode) {
      return fail(node, 'Unsupported function definition.')
    }

    if (name.includes('::')) {
      return fail(node, 'Out-of-class method definitions are not supported — define methods inside the class body.')
    }

    scope.push()

    const params = paramNames(declarator)

    for (const param of params) {
      scope.declare(param)
    }

    const code = `async function ${name}(${params.join(', ')}) ${emitBlock(bodyNode, ctx, '')}`

    scope.pop()

    return code
  }

  // ── Top level ─────────────────────────────────────────────────────────────

  function collectSyntaxErrors(node: TSNode): void {
    if (node.type === 'ERROR' || node.isMissing) {
      issues.push({
        line: node.startPosition.row + 1,
        message: `Syntax error near: ${node.text.slice(0, 40) || node.type}`,
      })

      return
    }
    if (node.hasError) {
      for (const child of node.children) {
        if (child) {
          collectSyntaxErrors(child)
        }
      }
    }
  }

  if (tree.rootNode.hasError) {
    collectSyntaxErrors(tree.rootNode)
    if (issues.length > 0) {
      throw new TranspileError(issues)
    }
  }

  for (const top of named(tree.rootNode)) {
    switch (top.type) {
      case 'preproc_include':
      case 'preproc_def':
      case 'preproc_call':
      case 'preproc_function_def':
      case 'preproc_ifdef':
      case 'using_declaration':
      case 'alias_declaration':
      case 'namespace_definition':
        break
      case 'class_specifier':
      case 'struct_specifier':
        chunks.push(emitClass(top))
        break
      case 'function_definition':
        chunks.push(emitFunction(top))
        break
      case 'declaration': {
        const core = emitDeclarationCore(top, { currentClass: null, asyncOk: false })

        if (core) {
          chunks.push(core)
        }
        break
      }
      case ';':
      case 'expression_statement':
        break
      default:
        fail(top, `Unsupported top-level construct: ${top.type}`)
    }
  }

  if (issues.length > 0) {
    throw new TranspileError(issues)
  }
  if (!globalFunctions.has('main')) {
    throw new TranspileError([{ line: 1, message: 'The program needs a main() function.' }])
  }

  chunks.push('return main(0, []);')

  return chunks.join('\n\n')
}
