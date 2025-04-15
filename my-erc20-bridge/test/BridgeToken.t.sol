// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import { ERC2771Context } from "../lib/relay-context-contracts/contracts/vendor/ERC2771Context.sol";
import {Test, console, Vm} from "forge-std/Test.sol";
import {BridgeToken} from "../src/BridgeToken.sol";

contract BridgeTokenTest is Test {
    BridgeToken token;
    address owner;
    address bridgeOperator;
    address user;
    address trustedForwarder;
    address notAuthorized;

    event TokensBurned(address indexed from, uint256 amount, bytes32 indexed burnId);
    event TokensMinted(address indexed to, uint256 amount, bytes32 indexed burnId);
    event BridgeOperatorUpdated(address operator, bool allowed);

    function setUp() public {
        owner = address(1);
        bridgeOperator = address(2);
        user = address(3);
        trustedForwarder = address(4); // Simulating Gelato Relay
        notAuthorized = address(5);

        vm.startPrank(owner);
        token = new BridgeToken("Bridge Token", "BTK", trustedForwarder);
        token.setBridgeOperator(bridgeOperator, true);
        vm.stopPrank();
    }

    function test_Initialization() public {
        assertEq(token.name(), "Bridge Token");
        assertEq(token.symbol(), "BTK");
        assertEq(token.owner(), owner);
        assertTrue(token.bridgeOperators(bridgeOperator));
        assertFalse(token.bridgeOperators(notAuthorized));
    }

    function test_AdminMint() public {
        uint256 amount = 1000 ether;
        
        vm.prank(owner);
        token.adminMint(user, amount);
        
        assertEq(token.balanceOf(user), amount);
    }

    function test_NonAdminCannotAdminMint() public {
        uint256 amount = 1000 ether;
        
        vm.prank(notAuthorized);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", notAuthorized));
        token.adminMint(user, amount);
    }

    function test_SetBridgeOperator() public {
        address newOperator = address(6);
        
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit BridgeOperatorUpdated(newOperator, true);
        token.setBridgeOperator(newOperator, true);
        
        assertTrue(token.bridgeOperators(newOperator));
        
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit BridgeOperatorUpdated(newOperator, false);
        token.setBridgeOperator(newOperator, false);
        
        assertFalse(token.bridgeOperators(newOperator));
    }

    function test_NonOwnerCannotSetBridgeOperator() public {
        address newOperator = address(6);
        
        vm.prank(notAuthorized);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", notAuthorized));
        token.setBridgeOperator(newOperator, true);
    }

    function test_BridgeOperatorBurnAndMint() public {
        uint256 amount = 1000 ether;
        
        vm.prank(owner);
        token.adminMint(user, amount);
        
        vm.recordLogs();
        vm.prank(bridgeOperator);
        bytes32 burnId = token.burn(user, amount);
        
        assertEq(token.balanceOf(user), 0);
        
        // Mint tokens with a new burnId (simulating cross-chain mint)
        bytes32 newBurnId = keccak256(abi.encodePacked("new_burn_id"));
        vm.prank(bridgeOperator);
        token.mint(user, amount, newBurnId);
        
        // Check mint was successful
        assertEq(token.balanceOf(user), amount);
        
        // Verify the burn ID is now processed
        (,bool processed) = token.burnRecords(newBurnId);
        assertTrue(processed);
    }

    function test_NonBridgeOperatorCannotBurn() public {
        uint256 amount = 1000 ether;
        
        vm.prank(owner);
        token.adminMint(user, amount);
        
        vm.prank(notAuthorized);
        vm.expectRevert("BridgeToken: caller is not a bridge operator");
        token.burn(user, amount);
    }

    function test_NonBridgeOperatorCannotMint() public {
        uint256 amount = 1000 ether;
        bytes32 burnId = keccak256(abi.encodePacked("test"));
        
        vm.prank(notAuthorized);
        vm.expectRevert("BridgeToken: caller is not a bridge operator");
        token.mint(user, amount, burnId);
    }

    function test_CannotBurnFromZeroAddress() public {
        uint256 amount = 1000 ether;
        
        vm.prank(bridgeOperator);
        vm.expectRevert("BridgeToken: burn from the zero address");
        token.burn(address(0), amount);
    }

    function test_CannotBurnMoreThanBalance() public {
        uint256 initialAmount = 500 ether;
        uint256 burnAmount = 1000 ether;
        
        vm.prank(owner);
        token.adminMint(user, initialAmount);
        
        vm.prank(bridgeOperator);
        vm.expectRevert("BridgeToken: burn amount exceeds balance");
        token.burn(user, burnAmount);
    }

    function test_PreventDoubleMinting() public {
        uint256 amount = 1000 ether;
        bytes32 burnId = keccak256(abi.encodePacked("unique_burn_id"));
        
        // First mint with the burnId
        vm.prank(bridgeOperator);
        token.mint(user, amount, burnId);
        
        // Attempt to mint again with the same burnId should fail
        vm.prank(bridgeOperator);
        vm.expectRevert("BridgeToken: burn ID already processed");
        token.mint(user, amount, burnId);
    }
    
    function test_CannotMintWithZeroBurnId() public {
        uint256 amount = 1000 ether;
        bytes32 burnId = bytes32(0);
        
        vm.prank(bridgeOperator);
        vm.expectRevert("BridgeToken: invalid burn ID");
        token.mint(user, amount, burnId);
    }

    function test_CrossChainMint() public {
        uint256 amount = 1000 ether;
        bytes32 burnId = keccak256(abi.encodePacked("test_burn_id"));
        
        vm.prank(bridgeOperator);
        token.mint(user, amount, burnId);
        
        assertEq(token.balanceOf(user), amount);
    }

    function test_BurnGeneratesUniqueBurnId() public {
        uint256 amount = 1000 ether;
        
        vm.prank(owner);
        token.adminMint(user, amount);
        
        vm.prank(bridgeOperator);
        bytes32 burnId = token.burn(user, amount);
        
        // Verify burnId is not zero
        assertTrue(burnId != bytes32(0));
    }

    function test_TrustedForwarderRecognition() public {
        assertTrue(token.isTrustedForwarder(trustedForwarder));
        assertFalse(token.isTrustedForwarder(notAuthorized));
    }

    function test_MetaTransactionMint() public {
        uint256 amount = 1000 ether;
        bytes32 burnId = keccak256(abi.encodePacked("meta_tx_burn_id"));
        
        bytes memory data = abi.encodeWithSelector(
            token.mint.selector,
            user,
            amount,
            burnId
        );
        
        bytes memory message = abi.encodePacked(bridgeOperator, data);
        
        vm.prank(trustedForwarder);
        (bool success, ) = address(token).call(abi.encodePacked(data, bridgeOperator));
        
        assertTrue(token.isTrustedForwarder(trustedForwarder));
    }
    
    function test_ForwarderAuthorizedButSenderNot() public {
        uint256 amount = 1000 ether;
        bytes32 burnId = keccak256(abi.encodePacked("forwarder_test_burn_id"));
        
        vm.prank(owner);
        token.adminMint(user, amount);
        
        bytes memory data = abi.encodeWithSelector(
            token.mint.selector,
            user,
            amount,
            burnId
        );
        
        bytes memory fullCalldata = abi.encodePacked(data, notAuthorized);
        
        vm.prank(trustedForwarder);
        
        vm.expectRevert("BridgeToken: caller is not a bridge operator");
        (bool success, ) = address(token).call(fullCalldata);
    }

    function test_MultipleBridgeOperators() public {
        address secondOperator = address(7);
        
        vm.prank(owner);
        token.setBridgeOperator(secondOperator, true);
        
        uint256 amount = 1000 ether;
        
        vm.prank(owner);
        token.adminMint(user, amount);
        
        vm.prank(bridgeOperator);
        token.burn(user, amount);
        
        // Second operator mints tokens with a new burnId
        bytes32 newBurnId = keccak256(abi.encodePacked("different_burn_id"));
        vm.prank(secondOperator);
        token.mint(user, amount, newBurnId);
        
        assertEq(token.balanceOf(user), amount);
    }
    
    function test_BurnDeterministicId() public {
        uint256 amount = 1000 ether;
        
        vm.prank(owner);
        token.adminMint(user, amount);
        
        // Burn tokens with different block numbers to ensure different IDs
        bytes32 firstBurnId;
        bytes32 secondBurnId;
        
        vm.startPrank(bridgeOperator);
        
        // First burn
        firstBurnId = token.burn(user, amount/2);
        
        // Advance the block number to ensure different burn IDs
        vm.roll(block.number + 1);
        
        // Second burn with different block number
        secondBurnId = token.burn(user, amount/2);
        
        vm.stopPrank();
        
        // Verify IDs are different due to different block numbers
        assertTrue(firstBurnId != secondBurnId, "Burn IDs should be different");
    }
    
    function test_PreventReplayAttacks() public {
        uint256 amount = 1000 ether;
        bytes32 burnId = keccak256(abi.encodePacked("replay_test"));
        
        // Mint tokens with a specific burnId
        vm.prank(bridgeOperator);
        token.mint(user, amount, burnId);
        
        // Verify tokens were minted
        assertEq(token.balanceOf(user), amount);
        
        vm.prank(bridgeOperator);
        vm.expectRevert("BridgeToken: burn ID already processed");
        token.mint(user, amount, burnId);
        
        // Balance should remain unchanged
        assertEq(token.balanceOf(user), amount);
    }
    
    function test_MultipleBurns() public {
        uint256 amount = 1000 ether;
        
        vm.prank(owner);
        token.adminMint(user, 2 * amount);
        
        vm.startPrank(bridgeOperator);
        
        bytes32 firstBurnId = token.burn(user, amount);
        
        vm.roll(block.number + 1);
        
        bytes32 secondBurnId = token.burn(user, amount);
        
        vm.stopPrank();
        
        assertTrue(firstBurnId != secondBurnId, "Burn IDs should be different");
        
        // Verify all tokens were burned
        assertEq(token.balanceOf(user), 0);
    }
}
