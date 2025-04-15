// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {BridgeToken} from "../src/BridgeToken.sol";

contract DeployBridgeToken is Script {
    address constant TRUSTED_FORWARDER_SEPOLIA = 0xd8253782c45a12053594b9deB72d8e8aB2Fca54c;
    address constant ADMIN = 0xf91f056855522C267624d5a921578D9a812E78F4;
    
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);
        
        BridgeToken token = new BridgeToken(
            "Bridge Token",
            "BTK",
            TRUSTED_FORWARDER_SEPOLIA
        );
        
        token.setBridgeOperator(ADMIN, true);        
        uint256 initialMintAmount = 1000000 * 10**18;
        token.adminMint(msg.sender, initialMintAmount);
        
        console.log("BridgeToken deployed to:", address(token));
        console.log("Initial Bridge Operator:", msg.sender);
        
        vm.stopBroadcast();
    }
}
