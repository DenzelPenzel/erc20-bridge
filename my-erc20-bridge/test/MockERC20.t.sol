// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {Test, console} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract MockERC20Test is Test {
    MockERC20 token;
    address owner;
    address operator;
    address user;
    address gelatoRelay;

    event TokensBurned(address indexed from, uint256 amount);
    event TokensMinted(address indexed to, uint256 amount);

    function setUp() public {        
        owner = address(1);
        operator = address(2);
        user = address(3);
        gelatoRelay = address(4);

        vm.prank(owner);
        token = new MockERC20("Mock Token", "MTK");

        vm.prank(owner);
        token.setBridgeOperator(operator, true);

        vm.prank(owner);
        token.setBridgeOperator(gelatoRelay, true);
    }

    function test_OnlyBridgeOperatorCanMint() public {
        uint256 amount = 1000;

        vm.prank(operator);
        token.mint(user, amount);

        assertEq(token.balanceOf(user), amount);
    }

    function testFuzz_testNonOperatorCannotMint() public {
        uint256 amount = 500;

        vm.prank(user);
        vm.expectRevert("Not authorized");
        token.mint(user, amount);
    }

    function test_OnlyBridgeOperatorCanBurn() public {
        uint256 initialAmount = 2000;

        vm.prank(owner);
        token.adminMint(user, initialAmount);

        vm.prank(operator);
        token.burn(user, initialAmount);

        assertEq(token.balanceOf(user), 0);
    }

    function test_NonOperatorCannotBurn() public {
        uint256 initialAmount = 2000;

        vm.prank(owner);
        token.adminMint(user, initialAmount);

        vm.prank(user);
        vm.expectRevert("Not authorized");
        token.burn(user, initialAmount);
    }

    function test_ERC20Transfer() public {
        uint256 initialAmount = 1000;

        vm.prank(owner);
        token.adminMint(user, initialAmount);

        uint256 transferAmount = 500;

        vm.prank(user);
        token.transfer(operator, transferAmount);

        assertEq(token.balanceOf(user), initialAmount - transferAmount);
        assertEq(token.balanceOf(operator), transferAmount);
    }

    function test_GelatoRelayCanBurnWithoutAllowance() public {
        uint256 initialAmount = 3000;

        // Mint tokens to the user
        vm.prank(owner);
        token.adminMint(user, initialAmount);
        assertEq(token.balanceOf(user), initialAmount);

        // Relay burns tokens without allowance
        uint256 burnAmount = 1500;
        vm.prank(gelatoRelay);
        
        // TokensBurned event to be emitted
        vm.expectEmit(true, false, false, true);
        emit TokensBurned(user, burnAmount);
        
        token.burn(user, burnAmount);

        // Check balance was reduced
        assertEq(token.balanceOf(user), initialAmount - burnAmount);
    }

    function test_BurnFailsIfExceedsBalance() public {
        uint256 initialAmount = 1000;

        vm.prank(owner);
        token.adminMint(user, initialAmount);

        // Try to burn more than the user has
        uint256 burnAmount = 1500;
        vm.prank(gelatoRelay);
        vm.expectRevert("ERC20: burn amount exceeds balance");
        token.burn(user, burnAmount);

        // Verify balance remains unchanged
        assertEq(token.balanceOf(user), initialAmount);
    }

    function test_BurnFromZeroAddress() public {
        // burn from zero address
        uint256 burnAmount = 100;
        vm.prank(gelatoRelay);
        vm.expectRevert("ERC20: burn from the zero address");
        token.burn(address(0), burnAmount);
    }

    function test_MultipleBridgeOperators() public {
        // Set up another bridge operator
        address anotherOperator = address(5);
        vm.prank(owner);
        token.setBridgeOperator(anotherOperator, true);

        uint256 initialAmount = 2000;
        vm.prank(owner);
        token.adminMint(user, initialAmount);

        // First operator burns some tokens
        uint256 firstBurnAmount = 500;
        vm.prank(operator);
        token.burn(user, firstBurnAmount);
        assertEq(token.balanceOf(user), initialAmount - firstBurnAmount);

        // Relay burns some tokens
        uint256 secondBurnAmount = 500;
        vm.prank(gelatoRelay);
        token.burn(user, secondBurnAmount);
        assertEq(token.balanceOf(user), initialAmount - firstBurnAmount - secondBurnAmount);

        // Another operator burns the rest
        uint256 thirdBurnAmount = 1000;
        vm.prank(anotherOperator);
        token.burn(user, thirdBurnAmount);
        assertEq(token.balanceOf(user), 0);
    }

    function test_RemoveBridgeOperator() public {
        uint256 initialAmount = 1000;
        vm.prank(owner);
        token.adminMint(user, initialAmount);

        // Remove Relay as bridge operator
        vm.prank(owner);
        token.setBridgeOperator(gelatoRelay, false);

        // Relay should no longer be able to burn
        vm.prank(gelatoRelay);
        vm.expectRevert("Not authorized");
        token.burn(user, 100);

        // Balance should remain unchanged
        assertEq(token.balanceOf(user), initialAmount);
    }
}
