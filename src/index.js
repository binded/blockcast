var txHexToJSON = require('bitcoin-tx-hex-to-json');
var async = require('async');

var bitcoinTransactionBuilder = require("./bitcoin-transaction-builder");
var dataPayload = require("./data-payload");

var post = function(options, callback) {
  var commonWallet = options.commonWallet;
  var commonBlockchain = options.commonBlockchain;
  var data = options.data;
  var fee = options.fee;
  var primaryTxHex = options.primaryTxHex;
  var signPrimaryTxHex = options.signPrimaryTxHex;
  var propagationStatus = options.propagationStatus || function() {};
  var buildStatus = options.buildStatus || function() {};
  var retryMax = options.retryMax || 5;
  var id = options.id || 0; // THINK ABOUT THIS!!! Maybe go through their recent transactions by default? options.transactions?
  bitcoinTransactionBuilder.createSignedTransactionsWithData({
    primaryTxHex: primaryTxHex,
    signPrimaryTxHex: signPrimaryTxHex,
    data: data, 
    id: id, 
    fee: fee,
    buildStatus: buildStatus,
    commonBlockchain: commonBlockchain,
    commonWallet: commonWallet
  }, function(err, signedTransactions, txid) {
    var reverseSignedTransactions = signedTransactions.reverse();
    var transactionTotal = reverseSignedTransactions.length;
    var propagateCounter = 0;
    var retryCounter = [];
    var propagateResponse = function(err, res) {
      propagationStatus({
        response: res,
        count: propagateCounter,
        transactionTotal: transactionTotal
      });
      if (err) {
        var rc = retryCounter[propagateCounter] || 0;
        if (rc < retryMax) {
          retryCounter[propagateCounter] = rc + 1;
          commonBlockchain.Transactions.Propagate(reverseSignedTransactions[propagateCounter], propagateResponse);
        }
        else {
          callback(err, false);
        }
      }
      propagateCounter++;
      if (propagateCounter < transactionTotal) {
        commonBlockchain.Transactions.Propagate(reverseSignedTransactions[propagateCounter], propagateResponse);
      }
      else {
        callback(false, {
          txid: txid,
          data: data,
          transactionTotal: transactionTotal
        });
      }
    }
    commonBlockchain.Transactions.Propagate(reverseSignedTransactions[0], propagateResponse);
  });
};

var payloadsLength = function(options, callback) {
  dataPayload.create({data: options.data, id: 0}, function(err, payloads) {
    if (err) {
      callback(err, payloads);
      return;
    }
    callback(false, payloads.length);
  });
};

var scanSingle = function(options, callback) {
  var txid = options.txid;
  var tx = options.tx;
  var commonBlockchain = options.commonBlockchain;
  var allTransactions = [];
  var payloads = [];
  var transactionTotal;
  var addresses = [];
  var length;
  var onTransaction = function(err, transactions, tx) {
    if (!tx && transactions[0].txHex) {
      tx = txHexToJSON(transactions[0].txHex);
    }
    if (!tx) {
      return callback(err, false);
    }
    if (allTransactions.length === 0) {
      tx.vin.forEach(function(vin) {
        vin.addresses.forEach(function(address) {
          if (addresses.indexOf(address) === -1) {
            addresses.push(address);
          }
        });
      });
    }
    var vout = tx.vout;
    for (var j = vout.length - 1; j >= 0; j--) {
      var output = vout[j];
      var scriptPubKey = output.scriptPubKey.hex;
      var scriptPubKeyASM = output.scriptPubKey.asm;
      if (scriptPubKeyASM.split(" ")[0] == "OP_RETURN") {
        var hex = scriptPubKeyASM.split(" ")[1] || "";
        var data;
        try {
          data = new Buffer(hex, "hex");
        }
        catch (e) {
          data = new Buffer("", "hex");
        }
        var parsedLength = dataPayload.parse(data);
        transactionTotal = parsedLength ? parsedLength : transactionTotal;
        payloads.push(data);
      }
    }
    if (allTransactions.length === 0 && !parsedLength) {
      return callback("not blockcast", false);
    }
    allTransactions.push(tx);
    if (allTransactions.length == transactionTotal) {
      dataPayload.decode(payloads, function(err, data) {
        callback(err, data, addresses);
      });
      return;
    }
    var prevTxid = tx.vin[tx.vin.length-1].txid;
    if (!prevTxid) {
      callback("missing: " + (allTransactions.length + 1), false);
      return;
    }
    else {
      commonBlockchain.Transactions.Get([prevTxid], onTransaction);
    }
  };
  if (tx) {
    onTransaction(false, [], tx);
  }
  else {
    commonBlockchain.Transactions.Get([txid], onTransaction)
  }
};

module.exports = {
  post: post,
  scanSingle: scanSingle,
  payloadsLength: payloadsLength,
  bitcoinTransactionBuilder: bitcoinTransactionBuilder
};