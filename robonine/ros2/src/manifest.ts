import type { PluginManifest } from '@robonine/plugin-sdk'

export const manifest: PluginManifest = {
  sdkVersion: '1',
  vendor: 'robonine',
  slug: 'ros2',
  name: {
    en: 'ROS2 lab',
    ru: 'Лаборатория ROS2',
  },
  description: {
    en: 'Write real ROS2 nodes in Python (rclpy) or C++ (rclcpp) and run them right in the browser. Your node talks to the robot through simulated topics — no ROS2 installation needed.',
    ru: 'Пишите настоящие ноды ROS2 на Python (rclpy) или C++ (rclcpp) и запускайте их прямо в браузере. Нода управляет роботом через симулируемые топики — установка ROS2 не нужна.',
  },
  icon: 'grip',
  scopes: ['robot.read', 'robot.control'],
}
