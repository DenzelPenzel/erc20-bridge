// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract DeployScript is Script {
    function setUp() public {}

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        console.log("Deployer:", deployer);

        uint256 balance = deployer.balance;
        console.log("Deployer ETH Balance:", balance);

        vm.startBroadcast(deployerPrivateKey);
        
        MockERC20 token = new MockERC20("Mock Token", "MTK");
        token.setBridgeOperator(deployer, true);
        token.mint(msg.sender, 1000000 * 10 ** token.decimals());
        
        address operator = 0xceA8aAa918bc6C19e5B77841ebD77ff3188385AF;
        token.setBridgeOperator(operator, true);
        token.mint(operator, 1000000 * 10 ** token.decimals());
        
        vm.stopBroadcast();

        console.log("MockERC20 deployed at:", address(token));
        console.log("Minted 1000000 tokens to:", msg.sender);
    }
}
