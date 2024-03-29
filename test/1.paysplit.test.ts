import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { BigNumber, Contract, ContractFactory } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { calculateBalance } from "./utils/calculate";

// Mocha has four functions that let you hook into the the test runner's lifecyle: `before`, `beforeEach`, `after`, `afterEach`.

describe("PaySplitter contract", function () {
  let PaySplitterFactory: ContractFactory;
  let contract: Contract;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let addr3: SignerWithAddress;
  let ownerWeight = 6;
  let weight1 = 4;
  let weight2 = 2;
  let weight3 = 8;
  let totalWeight: number;
  let totalBalance: BigNumber;
  // `beforeEach` will run before each test, re-deploying the contract every
  // time. It receives a callback, which can be async.

  beforeEach(async function () {
    // Get the ContractFactory and Signers here.
    totalWeight = 0;
    totalBalance = BigNumber.from("0");
    PaySplitterFactory = await ethers.getContractFactory("PaySplitter");
    [owner, addr1, addr2, addr3] = await ethers.getSigners();
    contract = await upgrades.deployProxy(PaySplitterFactory, [
      [owner.address, addr1.address],
      [ownerWeight, weight1],
    ]);
  });

  describe("Deployment", function () {
    it("Should set the right each weights", async function () {
      expect(await contract.weight(owner.address)).to.equal(ownerWeight);
      expect(await contract.weight(addr1.address)).to.equal(weight1);
    });
    it("Should set the right totalWeights", async function () {
      expect(await contract.totalWeights()).to.equal(ownerWeight + weight1);
    });
    it("Should set the right address", async function () {
      expect(await contract.payee(0)).to.equal(owner.address);
      expect(await contract.payee(1)).to.equal(addr1.address);
    });
    it("Should set the right role", async function () {
      const adminRole = await contract.DEFAULT_ADMIN_ROLE();
      const upgraderRole = await contract.UPGRADER_ROLE();
      expect(await contract.hasRole(adminRole, owner.address)).to.equal(true);
      expect(await contract.hasRole(upgraderRole, owner.address)).to.equal(
        true
      );
    });
  });

  describe("Transactions common", function () {
    it("Should deposit properly", async function () {
      let etherString = "1";
      let wei: BigNumber = ethers.utils.parseEther(etherString);
      totalBalance = totalBalance.add(wei);
      let tx = await contract.deposit({
        value: wei,
      });
      await tx.wait();
      expect(await contract.totalBalance()).to.equal(totalBalance);

      totalWeight = ownerWeight + weight1;

      wei = await calculateBalance(etherString, totalWeight, ownerWeight);
      expect(await contract.balance(owner.address)).to.equal(wei);
      wei = await calculateBalance(etherString, totalWeight, weight1);
      expect(await contract.balance(addr1.address)).to.equal(wei);
    });

    it("Should add payees properly", async function () {
      let tx = await contract.addPayee(
        [addr2.address, addr3.address],
        [weight2, weight3]
      );
      await tx.wait();
      expect(await contract.totalWeights()).to.equal(
        ownerWeight + weight1 + weight2 + weight3
      );
      expect(await contract.weight(addr2.address)).to.equal(weight2);
      expect(await contract.weight(addr3.address)).to.equal(weight3);
      expect(await contract.payee(2)).to.equal(addr2.address);
      expect(await contract.payee(3)).to.equal(addr3.address);
    });

    it("Should delete a payee properly", async function () {
      let tx = await contract.deletePayee(addr1.address);
      await tx.wait();
      expect(await contract.totalWeights()).to.equal(ownerWeight);
      expect(await contract.balance(addr1.address)).to.equal(0);
      expect(await contract.weight(addr1.address)).to.equal(0);
    });

    it("Should release properly", async function () {
      let etherString = "1";
      let wei: BigNumber = ethers.utils.parseEther(etherString);
      let tx = await contract.deposit({
        value: wei,
      });
      let receipt = await tx.wait();
      totalBalance = totalBalance.add(wei);
      totalWeight = ownerWeight + weight1;

      wei = await calculateBalance(etherString, totalWeight, ownerWeight);
      // let beforeReleaseBalance = await owner.getBalance();
      tx = await contract.release();
      receipt = await tx.wait();
      // let releaseGasUsed = receipt.gasUsed;
      // expect(await addWei(await owner.getBalance(), releaseGasUsed)).to.equal(await addWei(beforeReleaseBalance, wei))
      expect(await contract.balance(owner.address)).to.equal(0);

      expect(await contract.totalBalance()).to.equal(
        await totalBalance.sub(wei)
      );
    });
  });

  describe("Transactions deposit revert", function () {
    it("Should fail if sender doesn't send enough eth", async function () {
      let etherString = "0";
      await expect(
        contract.deposit({
          value: ethers.utils.parseEther(etherString),
        })
      ).to.be.revertedWith("The value must be bigger than 0");
      await expect(
        addr1.sendTransaction({
          to: contract.address,
          value: ethers.utils.parseEther(etherString),
        })
      ).to.be.revertedWith("The value must be bigger than 0");
    });
    it("Should fail if there is no payees when deposit", async function () {
      let tx = await contract.deletePayee(owner.address);
      await tx.wait();
      tx = await contract.deletePayee(addr1.address);
      await tx.wait();
      let etherString = "1";
      await expect(
        contract.deposit({
          value: ethers.utils.parseEther(etherString),
        })
      ).to.be.revertedWith("You need one payee at least");
    });
  });

  describe("Transactions addPayee revert", function () {
    it("Should fail if non admin tries to do addPayee", async function () {
      let adminHexString: string = await contract.DEFAULT_ADMIN_ROLE();
      // let errMsg: string = "AccessControl: account " + String(ethers.utils.getAddress(addr1.address)) + " is missing role " + adminHexString;
      let errMsg = `AccessControl: account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is missing role ${adminHexString}`;
      // console.log(errMsg);
      await expect(
        contract.connect(addr1).addPayee([addr2.address, addr3.address], [3, 4])
      ).to.be.revertedWith(errMsg);
    });
    it("Should fail if admin tries to do addPayee with diffrent length args", async function () {
      await expect(
        contract.addPayee([addr2.address, addr3.address], [3, 4, 5])
      ).to.be.revertedWith("PaySplitter: payees and weights length mismatch");
      await expect(
        contract.addPayee([addr1.address, addr2.address, addr3.address], [3, 4])
      ).to.be.revertedWith("PaySplitter: payees and weights length mismatch");
    });
    it("Should fail if admin tries to do addPayee with the address already added", async function () {
      await expect(
        contract.addPayee([addr2.address, addr1.address], [3, 4])
      ).to.be.revertedWith("PaySplitter: account already has weights");
      await expect(contract.addPayee([owner.address], [4])).to.be.revertedWith(
        "PaySplitter: account already has weights"
      );
      let tx = await contract.addPayee([addr2.address, addr3.address], [3, 4]);
      await tx.wait();
      await expect(contract.addPayee([addr3.address], [4])).to.be.revertedWith(
        "PaySplitter: account already has weights"
      );
    });
    it("Should fail if weights are not right", async function () {
      await expect(
        contract.addPayee([addr2.address, addr3.address], [0, 4])
      ).to.be.revertedWith("PaySplitter: 0 < weight <= 10000");
      await expect(
        contract.addPayee([addr2.address], [10001])
      ).to.be.revertedWith("PaySplitter: 0 < weight <= 10000");
    });
  });

  describe("Transactions deletePayee revert", function () {
    it("Should fail if non admin tries to do deletePayee", async function () {
      let adminHexString: string = await contract.DEFAULT_ADMIN_ROLE();
      // let errMsg: string = "AccessControl: account " + String(ethers.utils.getAddress(addr1.address)) + " is missing role " + adminHexString;
      let errMsg = `AccessControl: account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is missing role ${adminHexString}`;
      // console.log(errMsg);
      await expect(
        contract.connect(addr1).deletePayee(addr1.address)
      ).to.be.revertedWith(errMsg);
    });

    it("Should fail if there is no payees when deletePayee", async function () {
      let tx = await contract.deletePayee(owner.address);
      await tx.wait();
      tx = await contract.deletePayee(addr1.address);
      await tx.wait();
      await expect(contract.deletePayee(owner.address)).to.be.revertedWith(
        "PaySplitter: no payees"
      );
    });

    it("Should fail if there is still balance when deletePayee", async function () {
      let etherString = "1";
      let wei: BigNumber = ethers.utils.parseEther(etherString);
      let tx = await contract.deposit({
        value: wei,
      });
      await tx.wait();
      await expect(contract.deletePayee(owner.address)).to.be.revertedWith(
        "PaySplitter: There is balance in the account"
      );
    });

    it("Should fail if there is not the payees when deletePayee", async function () {
      let tx = await contract.deletePayee(addr1.address);
      await tx.wait();
      await expect(contract.deletePayee(addr1.address)).to.be.revertedWith(
        "PaySplitter: account has no weights"
      );
    });
  });

  describe("Transactions release revert", function () {
    it("Should fail if non payee tries to release", async function () {
      await expect(contract.connect(addr2).release()).to.be.revertedWith(
        "PaySplitter: account has no weights"
      );
    });
    it("Should fail if payee doesn't have balance", async function () {
      let tx = await contract.deposit({
        value: ethers.utils.parseEther("1"),
      });
      await tx.wait();
      tx = await contract.connect(addr1).release();
      await tx.wait();
      await expect(contract.connect(addr1).release()).to.be.revertedWith(
        "PaySplitter: account is not due payment"
      );
    });
  });

  describe("Transactions various cases", function () {
    it("various case 1 ", async function () {
      let etherString = "1";
      let wei: BigNumber = ethers.utils.parseEther(etherString);
      let tx = await contract.deposit({
        value: wei,
      });
      await tx.wait();
      expect(await contract.totalBalance()).to.equal(wei);

      totalWeight = ownerWeight + weight1;

      wei = await calculateBalance(etherString, totalWeight, ownerWeight);
      expect(await contract.balance(owner.address)).to.equal(wei);
      let wei1: BigNumber = await calculateBalance(
        etherString,
        totalWeight,
        weight1
      );

      tx = await contract.addPayee(
        [addr2.address, addr3.address],
        [weight2, weight3]
      );
      await tx.wait();
      totalWeight += weight2 + weight3;

      expect(await contract.totalWeights()).to.equal(totalWeight);

      tx = await contract.release();
      await tx.wait();

      expect(await contract.balance(owner.address)).to.equal(0);

      await addr1.sendTransaction({
        to: contract.address,
        value: ethers.utils.parseEther(etherString),
      });

      wei = await calculateBalance(etherString, totalWeight, ownerWeight);
      expect(await contract.balance(owner.address)).to.equal(wei);
      wei = await calculateBalance(etherString, totalWeight, weight1);
      expect(await contract.balance(addr1.address)).to.equal(
        await wei.add(wei1)
      );

      await expect(contract.deletePayee(owner.address)).to.be.revertedWith(
        "PaySplitter: There is balance in the account"
      );
    });
  });
});
