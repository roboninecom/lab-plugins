import { javascriptGenerator, Order } from 'blockly/javascript'
import * as Blockly from 'blockly'

const MOTION_COLOR = '#4C97FF'
const SENSING_COLOR = '#5BA4CF'
const UTILITY_COLOR = '#9966FF'

const JOINT_OPTIONS: [string, string][] = [
  ['shoulder pan', 'shoulder_pan'],
  ['shoulder lift', 'shoulder_lift'],
  ['elbow', 'elbow_flex'],
  ['wrist flex', 'wrist_flex'],
  ['wrist roll', 'wrist_roll'],
]

const AXIS_OPTIONS: [string, string][] = [
  ['X', 'X'],
  ['Y', 'Y'],
  ['Z', 'Z'],
]

let registered = false

export function registerRobotBlocks() {
  if (registered) {
    return
  }
  registered = true

  // ── Move joint ─────────────────────────────────────────────────────────────
  Blockly.Blocks['robot_move_joint'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('move').appendField(new Blockly.FieldDropdown(JOINT_OPTIONS), 'JOINT').appendField('to')
      this.appendValueInput('ANGLE').setCheck('Number')
      this.appendDummyInput().appendField('°')
      this.setInputsInline(true)
      this.setPreviousStatement(true, null)
      this.setNextStatement(true, null)
      this.setColour(MOTION_COLOR)
      this.setTooltip('Move a joint to an angle in degrees.')
    },
  }
  javascriptGenerator.forBlock['robot_move_joint'] = function (block, gen) {
    const joint = block.getFieldValue('JOINT') as string
    const angle = gen.valueToCode(block, 'ANGLE', Order.NONE) || '0'

    return `await robot.moveJoint('${joint}', ${angle});\n`
  }

  // ── Open / close gripper ────────────────────────────────────────────────────
  Blockly.Blocks['robot_gripper'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput()
        .appendField(
          new Blockly.FieldDropdown([
            ['open', 'open'],
            ['close', 'close'],
          ] as [string, string][]),
          'ACTION',
        )
        .appendField('gripper')
      this.setPreviousStatement(true, null)
      this.setNextStatement(true, null)
      this.setColour(MOTION_COLOR)
      this.setTooltip('Open or close the gripper.')
    },
  }
  javascriptGenerator.forBlock['robot_gripper'] = function (block) {
    const action = block.getFieldValue('ACTION') as string

    return `await robot.gripper('${action}');\n`
  }

  // ── Go home ─────────────────────────────────────────────────────────────────
  Blockly.Blocks['robot_go_home'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('go to home position')
      this.setPreviousStatement(true, null)
      this.setNextStatement(true, null)
      this.setColour(MOTION_COLOR)
      this.setTooltip('Move all joints to the neutral home position.')
    },
  }
  javascriptGenerator.forBlock['robot_go_home'] = function () {
    return 'await robot.goHome();\n'
  }

  // ── Move end effector to XYZ ────────────────────────────────────────────────
  Blockly.Blocks['robot_move_to_xyz'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('move end effector to')
      this.appendValueInput('X').setCheck('Number').appendField('x:')
      this.appendValueInput('Y').setCheck('Number').appendField('y:')
      this.appendValueInput('Z').setCheck('Number').appendField('z:')
      this.appendDummyInput().appendField('mm')
      this.setInputsInline(true)
      this.setPreviousStatement(true, null)
      this.setNextStatement(true, null)
      this.setColour(MOTION_COLOR)
      this.setTooltip('Move the end effector to a position in millimetres using inverse kinematics.')
    },
  }
  javascriptGenerator.forBlock['robot_move_to_xyz'] = function (block, gen) {
    const x = gen.valueToCode(block, 'X', Order.NONE) || '0'
    const y = gen.valueToCode(block, 'Y', Order.NONE) || '0'
    const z = gen.valueToCode(block, 'Z', Order.NONE) || '0'

    return `await robot.moveToXYZ(${x}, ${y}, ${z});\n`
  }

  // ── Get joint angle (value) ─────────────────────────────────────────────────
  Blockly.Blocks['robot_get_joint'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('angle of').appendField(new Blockly.FieldDropdown(JOINT_OPTIONS), 'JOINT').appendField('(°)')
      this.setOutput(true, 'Number')
      this.setColour(SENSING_COLOR)
      this.setTooltip('Current joint angle in degrees.')
    },
  }
  javascriptGenerator.forBlock['robot_get_joint'] = function (block) {
    const joint = block.getFieldValue('JOINT') as string

    return [`robot.getJoint('${joint}')`, Order.FUNCTION_CALL]
  }

  // ── Get end effector position component (value) ─────────────────────────────
  Blockly.Blocks['robot_get_effector'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('end effector').appendField(new Blockly.FieldDropdown(AXIS_OPTIONS), 'AXIS').appendField('(mm)')
      this.setOutput(true, 'Number')
      this.setColour(SENSING_COLOR)
      this.setTooltip('Current end effector position along the chosen axis in mm.')
    },
  }
  javascriptGenerator.forBlock['robot_get_effector'] = function (block) {
    const axis = block.getFieldValue('AXIS') as string

    return [`robot.getEffector('${axis}')`, Order.FUNCTION_CALL]
  }

  // ── Get gripper pressure (value) ─────────────────────────────────────────────
  Blockly.Blocks['robot_get_pressure'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('gripper pressure (0 – 10)')
      this.setOutput(true, 'Number')
      this.setColour(SENSING_COLOR)
      this.setTooltip('Estimated gripper contact force from 0 (open) to 10 (fully closed).')
    },
  }
  javascriptGenerator.forBlock['robot_get_pressure'] = function () {
    return ['robot.getPressure()', Order.FUNCTION_CALL]
  }

  // ── Wait ────────────────────────────────────────────────────────────────────
  Blockly.Blocks['robot_wait'] = {
    init(this: Blockly.Block) {
      this.appendValueInput('MS').setCheck('Number').appendField('wait')
      this.appendDummyInput().appendField('ms')
      this.setInputsInline(true)
      this.setPreviousStatement(true, null)
      this.setNextStatement(true, null)
      this.setColour(UTILITY_COLOR)
      this.setTooltip('Pause execution for the given number of milliseconds.')
    },
  }
  javascriptGenerator.forBlock['robot_wait'] = function (block, gen) {
    const ms = gen.valueToCode(block, 'MS', Order.NONE) || '0'

    return `await robot.wait(${ms});\n`
  }

  // ── Print ────────────────────────────────────────────────────────────────────
  Blockly.Blocks['robot_print'] = {
    init(this: Blockly.Block) {
      this.appendValueInput('TEXT').appendField('print')
      this.setInputsInline(true)
      this.setPreviousStatement(true, null)
      this.setNextStatement(true, null)
      this.setColour(UTILITY_COLOR)
      this.setTooltip('Print a value to the output panel.')
    },
  }
  javascriptGenerator.forBlock['robot_print'] = function (block, gen) {
    const text = gen.valueToCode(block, 'TEXT', Order.NONE) || '""'

    return `robot.print(String(${text}));\n`
  }
}

// ── Toolbox definition ────────────────────────────────────────────────────────

export const toolbox: Blockly.utils.toolbox.ToolboxDefinition = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Motion',
      colour: MOTION_COLOR,
      contents: [
        {
          kind: 'block',
          type: 'robot_move_joint',
          inputs: { ANGLE: { shadow: { type: 'math_number', fields: { NUM: 0 } } } },
        },
        { kind: 'block', type: 'robot_go_home' },
        {
          kind: 'block',
          type: 'robot_move_to_xyz',
          inputs: {
            X: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
            Y: { shadow: { type: 'math_number', fields: { NUM: 100 } } },
            Z: { shadow: { type: 'math_number', fields: { NUM: 200 } } },
          },
        },
        { kind: 'block', type: 'robot_gripper' },
      ],
    },
    {
      kind: 'category',
      name: 'Sensing',
      colour: SENSING_COLOR,
      contents: [
        { kind: 'block', type: 'robot_get_joint' },
        { kind: 'block', type: 'robot_get_effector' },
        { kind: 'block', type: 'robot_get_pressure' },
      ],
    },
    {
      kind: 'category',
      name: 'Control',
      colour: '#FFAB19',
      contents: [
        { kind: 'block', type: 'robot_wait', inputs: { MS: { shadow: { type: 'math_number', fields: { NUM: 500 } } } } },
        { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: 5 } } } } },
        { kind: 'block', type: 'controls_whileUntil' },
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'controls_ifelse' },
      ],
    },
    {
      kind: 'category',
      name: 'Logic',
      colour: '#5b80a5',
      contents: [
        { kind: 'block', type: 'logic_compare' },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
      ],
    },
    {
      kind: 'category',
      name: 'Math',
      colour: '#5CA65C',
      contents: [
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic' },
        { kind: 'block', type: 'math_single' },
        { kind: 'block', type: 'math_round' },
        { kind: 'block', type: 'math_constrain' },
        { kind: 'block', type: 'math_random_int' },
      ],
    },
    {
      kind: 'category',
      name: 'Variables',
      custom: 'VARIABLE',
      colour: '#FF8C1A',
    },
  ],
}
