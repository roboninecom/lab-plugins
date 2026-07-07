// Starter programs shown when the tool opens. Both do the same thing: wait
// for /joint_states, then wave the first joint with a sine trajectory
// published to the forward position controller.

export const PYTHON_SAMPLE = `import rclpy
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import Float64MultiArray

import numpy as np

COMMAND_TOPIC = '/forward_position_controller/commands'


class WaveNode(Node):
    def __init__(self):
        super().__init__('wave_node')
        self.home = None
        self.t = 0.0
        self.create_subscription(JointState, '/joint_states', self.joint_state_callback, 10)
        self.cmd_pub = self.create_publisher(Float64MultiArray, COMMAND_TOPIC, 10)
        self.timer = self.create_timer(0.05, self.control_loop)
        self.get_logger().info('Wave node started, waiting for /joint_states...')

    def joint_state_callback(self, msg: JointState):
        if self.home is None:
            self.home = np.array(msg.position)
            self.get_logger().info(f'Robot has {len(msg.name)} joints: {", ".join(msg.name)}')

    def control_loop(self):
        if self.home is None:
            return
        self.t += 0.05
        target = self.home.copy()
        target[4] = self.home[4] + 0.6 * np.sin(2 * np.pi * 0.25 * self.t)
        cmd = Float64MultiArray()
        cmd.data = target.tolist()
        self.cmd_pub.publish(cmd)


def main(args=None):
    rclpy.init(args=args)
    node = WaveNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
`

export const CPP_SAMPLE = `#include <chrono>
#include <cmath>
#include <memory>
#include <vector>

#include "rclcpp/rclcpp.hpp"
#include "sensor_msgs/msg/joint_state.hpp"
#include "std_msgs/msg/float64_multi_array.hpp"

using namespace std::chrono_literals;
using std::placeholders::_1;

class WaveNode : public rclcpp::Node
{
public:
  WaveNode() : Node("wave_node")
  {
    subscription_ = create_subscription<sensor_msgs::msg::JointState>(
      "/joint_states", 10, std::bind(&WaveNode::joint_state_callback, this, _1));
    publisher_ = create_publisher<std_msgs::msg::Float64MultiArray>(
      "/forward_position_controller/commands", 10);
    timer_ = create_wall_timer(50ms, std::bind(&WaveNode::control_loop, this));
    RCLCPP_INFO(get_logger(), "Wave node started, waiting for /joint_states...");
  }

private:
  void joint_state_callback(const sensor_msgs::msg::JointState & msg)
  {
    if (!got_state_) {
      home_ = msg.position;
      got_state_ = true;
      RCLCPP_INFO(get_logger(), "Robot has %zu joints", msg.name.size());
    }
  }

  void control_loop()
  {
    if (!got_state_) {
      return;
    }
    t_ = t_ + 0.05;

    auto cmd = std_msgs::msg::Float64MultiArray();
    for (double p : home_) {
      cmd.data.push_back(p);
    }
    cmd.data[4] = home_[4] + 0.6 * std::sin(2.0 * M_PI * 0.25 * t_);
    publisher_->publish(cmd);
  }

  rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr subscription_;
  rclcpp::Publisher<std_msgs::msg::Float64MultiArray>::SharedPtr publisher_;
  rclcpp::TimerBase::SharedPtr timer_;
  std::vector<double> home_;
  bool got_state_ = false;
  double t_ = 0.0;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<WaveNode>());
  rclcpp::shutdown();
  return 0;
}
`
