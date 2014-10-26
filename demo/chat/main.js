/*jslint sloppy:true */
/*globals freedom, console */
/**
 * Chat demo backend.
 * Because the Social API provides message passing primitives,
 * this backend simply forwards messages between the front-end and our Social provider
 * Note that you should be able to plug-and-play a variety of social providers
 * and still have a working demo
 *
 **/

var logger;
freedom.core().getLogger('[Chat Backend]').then(function (log) { logger = log; });

var Chat = function (dispatchEvent) {
  this.dispatchEvent = dispatchEvent;

  this.userList = {};    //Keep track of the roster
  this.clientList = {};
  this.myClientState = null;
  this.social = freedom.socialprovider();

  this.paxosInstances = [];
  this.numNodes = 3; //hardcode for now
  this.majorityNodes = Math.ceil(this.numNodes / 2);  
  this.messageQueues = [[],[],[]]; /* LEAVE, JOIN, MSG all should be small, can use shift/unshift */
  
  this.boot();
};

 /* Message format: TYPE inst [[new]prepNum] [[new]idNum] [oldprepNum] [oldIdNum] [value] */
  function makePaxosMessage(type, instNum, prepNum, idNum, oldPrep, oldId, value) {
    var msg = {
        type: type,
        inst: instNum};
    if (prepNum) {
      msg.prepNum = prepNum;
      msg.idNum = idNum;
    }
    if (oldPrep) {
      msg.oldPrep = oldPrep;
      msg.oldId = oldId;
    }
    if (value) {
      msg.value = value;
    }
  }

/* Constructor for paxos instances */
function newPaxosInstance(prepareNum, idNum) {
    this.state = "Prepared"; /* Prepared Accepted Learned */
    this.promiseNum = prepareNum;
    this.promiseId = idNum;
    this.acceptors = new Array(this.numNodes);
    this.numAccepts = 0;
    for (var i = 0; i < this.acceptors.length; i++) {
      this.acceptors[i] = 0;
    }
    if (idNum === this.myID) {
      this.promisers = new Array(this.numNodes);
      for(i = 0; i < this.promisers.length; i++) {
        this.promisers[i] = 0;
      }
      this.promisers[this.myID] = 1;
      this.numPromises = 1;
    }
  }

/* instNum should be contiguous, but doesn't have to be in Javascript arrays */
  function addPaxosInstance(instNum, prepareNum, idNum) {
    console.log("Starting Paxos instance" + instNum);
    this.paxosInstances[instNum] = newPaxosInstance(prepareNum);
    return instNum;
  }

  /* Make a new instance with a proposal and send it to everyone */
  function prepareMyInstance() {
    var newInst = addPaxosInstance(this.paxosInstances.length - 1, 0, this.myID);

    for (var userId in this.userList) {
      if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
        this.send(userId, makePaxosMessage("PREP", newInst, 0, this.myID, null, null, null));
      }
    }
  }
  
  /* What the UI now calls instead of send when there's a new message */
Chat.prototype.enqueue = function(msg) {
  this.messageQueue[2].push(msg);
  prepareMyInstance();
};
  
  /* Starting over with a new preparation number, clear promisers and wait for timeout */
  function upgradePrepare(inst, prepNum) {
    this.paxosInstances[inst].numPromises = 0;
    for (var i = 0; i < this.paxosInstances[inst].promisers.length; i++) {
      this.paxosInstances[inst].promisers[i] = 0;
    }
    if (this.paxosInstances[inst].hasOwnProperty('numNACKs')) {
      delete this.paxosInstances[inst].numNACKs;
      delete this.paxosInstances[inst].highestNACKnum;
    }
    if (this.paxosInstances[inst].hasOwnProperty('highestPromNum')) {
      delete this.paxosInstances[inst].highestPromNum;
      delete this.paxosInstances[inst].highestPromVal;
    }
    (function(inst, prepNum) { /*closure */
      setTimeout(function() {
        if (this.paxosInstances[inst].state !== "Learned") {
          var newPrepNum = Math.max(prepNum, this.paxosInstances[inst].promiseNum) + 1;
          this.paxosInstances[inst].promiseNum = newPrepNum;
          this.paxosInstances[inst].promiseId = this.myID;
          this.paxosInstances[inst].numPromises = 1;
          this.paxosInstances[inst].promisers[this.myID] = 1;
          for (var userId in this.userList) {
            if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
              this.send(userId, makePaxosMessage("PREP", inst, newPrepNum, this.myID, null, null, null));
            }
          }
        }
      }, 15000+Math.floor(Math.random()*20000)); /* 25 seconds +- 10 seconds */
    })(inst, prepNum);
  }
  
  function learnValue(inst, prepNum, idNum, value) {
    if (this.paxosInstances[inst].hasOwnProperty('promisers')) {
      delete this.paxosInstances[inst].promisers;
      delete this.paxosInstances[inst].numPromises;
    }
    this.paxosInstances[inst].acceptedPNum = prepNum;
    this.paxosInstances[inst].acceptedId = idNum;
    this.paxosInstances[inst].value = value;
    this.paxosInstances[inst].state = "Learned";
    
    // if (value.type === "LEAVE") { reduce numNodes, majorityNodes, etc. }
    // else if (value.type === "JOIN") { add to numNodes, majorityNodes, etc. }
    // else send the value's data
    /* Send the learned value to the UX */
    this.dispatchEvent('recv-message', {from: idNum, value:value});
  }

/** 
 * sent messages should be forwarded to the Social provider.
 **/
Chat.prototype.send = function (to, message) {
  console.log("Send to: " + to);
  return this.social.sendMessage(to, message);
};

Chat.prototype.boot = function () {
  this.social.login({
    agent: 'chatdemo',
    version: '0.1',
    url: '',
    interactive: true,
    rememberLogin: false
  }).then(function (ret) {
    this.myClientState = ret;
    this.this.myID = ret.userId;
    logger.log("onLogin", this.myClientState);
    if (ret.status === this.social.STATUS.ONLINE) {
      this.this.myID = ret.userId;
      this.dispatchEvent('recv-uid', ret.clientId);
      this.dispatchEvent('recv-status', "online");
    } else {
      this.dispatchEvent('recv-status', "offline");
    }
  }.bind(this), function (err) {
    logger.log("Log In Failed", err);
    this.dispatchEvent("recv-err", err);
  }.bind(this));

  this.updateBuddyList();

  /**
  * on an 'onMessage' event from the Social provider
  * Paxos logic goes here, learned values are forwarded
  */
  this.social.on('onMessage', function (data) {
    var from = +data.from.userId,
      split = data.message.split(' '), 
      type = split[0],
      inst = +split[1], 
      prepNum, 
      value = null,
      oldProm = null,
      oldId = null,
      myPromiseId,
      myPromiseNum, 
      i, 
      userId;
    console.log("Received " + data.message + " from " + from);
    switch(type)
    {
      case 'PREP':
        prepNum = +split[2];
        if (inst < this.paxosInstances.length)
        {
          if (this.paxosInstances[inst].hasOwnProperty('value')) {
            value = this.paxosInstances[inst].value;
          }
          if (this.paxosInstances[inst].hasOwnProperty('acceptedPNum')) {
            oldProm = this.paxosInstances[inst].acceptedPNum;
            oldId = this.paxosInstances[inst].acceptedId;
          }
          switch (this.paxosInstances[inst].state) {
            case 'Prepared':
              /* if prepare is higher, fix self if necessary and send PROM, else NACK */
              myPromiseNum = this.paxosInstances[inst].promiseNum;
              myPromiseId = this.paxosInstances[inst].promiseId;
              if (prepNum > myPromiseNum) {
                if (this.paxosInstances[inst].promiseId === this.myID) {
                  upgradePrepare(inst, prepNum); /* wait timeout then try to prepare again */
                }
                this.paxosInstances[inst].promiseNum = prepNum;
                this.paxosInstances[inst].promiseId = from;
                this.send(from, makePaxosMessage("PROM", inst, prepNum, from, null, null, null));
              }
              else { 
                this.send(from, makePaxosMessage("NACK", inst, myPromiseNum, 
                                                       this.paxosInstances[inst].promiseId, 
                                                       null, null, null));
              }
              break;
            case 'Accepted':
              /* if prepare is higher, send PROM, else NACK */
              myPromiseNum = this.paxosInstances[inst].promiseNum;
              if (prepNum > myPromiseNum) {
                this.paxosInstances[inst].promiseNum = prepNum;
                this.paxosInstances[inst].promiseId = from;
                this.send(from, makePaxosMessage("PROM", inst, prepNum, from, oldProm, oldId, value));
              }
              else {
                this.send(from, makePaxosMessage("NACK", inst, myPromiseNum, 
                                                       this.paxosInstances[inst].promiseId,
                                                       oldProm, oldId, value));
              }
              break;
            case 'Learned':
              /* if prepare is higher, send LRNP, else send LRND */
              myPromiseNum = this.paxosInstances[inst].promiseNum;
              if (prepNum > myPromiseNum) {
                this.paxosInstances[inst].promiseNum = prepNum;
                this.paxosInstances[inst].promiseId = from;
                this.send(from, makePaxosMessage("LRNP", inst, prepNum, from, oldProm, oldId, value));
              }
              else {/* not raising promise number, would be NACK but send LRND instead */
                this.send(from, makePaxosMessage("LRND", inst, myPromiseNum, 
                                                       this.paxosInstances[inst].promiseId, 
                                                       oldProm, oldId, value));
              }
              break;
            default:
              console.log("ERROR: Unknown state for instance " + inst + " that just received a prepare");
          }
        }
        else  { /* make a new instance, catch up if necessary and promise */
          for (i = this.paxosInstances.length; i < inst; i++) {
            prepareMyInstance(); /* send 0 to everyone on that instance in hopes of learning */
          }
          addPaxosInstance(inst, prepNum, from);
          this.send(from, makePaxosMessage("PROM", inst, prepNum, null, null, null));
        }
        break;
      case 'PROM':
        /* sanity check - I had sent a prepare */
        if (inst < this.paxosInstances.length && this.paxosInstances[inst].hasOwnProperty('promisers')) {
          prepNum = +split[2];
          if (split.length > 3) {
            /* there's already a value here, keep track of it */
            oldProm = +split[4];
            value = split[6];
            if (!this.paxosInstances[inst].hasOwnProperty('highestPromNum') || 
                this.paxosInstances[inst].highestPromNum < oldProm) {
              this.paxosInstances[inst].highestPromNum = oldProm;
              this.paxosInstances[inst].highestPromVal = value;
            }
          }
          if (this.paxosInstances[inst].promisers[from] === false) { /* not a dup */
            this.paxosInstances[inst].promisers[from] = true;
            this.paxosInstances[inst].numPromises++;
            if (this.paxosInstances[inst].numPromises >= this.majorityNodes &&
                (this.paxosInstances[inst].hasOwnProperty('highestPromVal') || this.messageQueue.length > 0)) { 
              /* Code guarantees node will always be able to accept itself */
              var myVal;
              if (this.paxosInstances[inst].hasOwnProperty('highestPromVal')) {
                myVal = this.paxosInstances[inst].highestPromVal;
                this.paxosInstances[inst].valFromQueue = false;
              }
              else {
                myVal = this.messageQueue.shift();
                this.paxosInstances[inst].valFromQueue = true;
              }
              this.paxosInstances[inst].value = myVal;
              this.paxosInstances[inst].acceptors[this.myID] = true;
              this.paxosInstances[inst].numAccepts = 1;
              this.paxosInstances[inst].state = "Accepted";
              delete this.paxosInstances[inst].numPromises;
              delete this.paxosInstances[inst].promisers;
              if (this.paxosInstances[inst].hasOwnProperty('numNACKs')) {
                delete this.paxosInstances[inst].numNACKs;
                delete this.paxosInstances[inst].highestNACKnum;
              }
              if (this.paxosInstances[inst].hasOwnProperty('highestPromNum')) {
                delete this.paxosInstances[inst].highestPromNum;
                delete this.paxosInstances[inst].highestPromVal;
              }
              console.log("Instance " + inst + " received promises, proposing value " + myVal);
              for (userId in this.userList) {
                if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
                  this.send(userId, makePaxosMessage("AREQ", inst, prepNum, this.myID, null, null, myVal));
                  this.send(userId, makePaxosMessage("ACPT", inst, prepNum, this.myID, null, null, myVal));
                }
              }
            } /* end majority promises */
          }
        }
        break;
      case "NACK": 
        /* responding to either a prepare or an accept request */
        if (inst < this.paxosInstances.length && this.paxosInstances[inst].promiseNum < +split[2]) { /* sanity check */
          prepNum = +split[2];
          if (this.paxosInstances[inst].state === "Prepared" && this.paxosInstances[inst].promisers[from] === 0) {
            this.paxosInstances[inst].promisers[from] = -1;
            if (this.paxosInstances[inst].hasOwnProperty('numNACKs')) {
              this.paxosInstances[inst].numNACKs++;
              if (this.paxosInstances[inst].highestNACKnum < prepNum) {
                this.paxosInstances[inst].highestNACKnum = prepNum;
              }
            }
            else {
              this.paxosInstances[inst].numNACKs = 1;
              this.paxosInstances[inst].highestNACKnum = prepNum;
            }
            if (this.paxosInstances[inst].numNACKs >= this.majorityNodes) { /* well we failed */
              upgradePrepare(inst, this.paxosInstances[inst].highestNACKnum);
            }            
          }
          else if (this.paxosInstances[inst].state === "Accepted" && 
                   this.paxosInstances[inst].acceptors[from] === 0) {
            /* Add to NACKS, if majority, requeue value if necessary and upgrade prepare */
            this.paxosInstances[inst].acceptors[from] = -1;
            if (this.paxosInstances[inst].hasOwnProperty('numNACKs')) {
              this.paxosInstances[inst].numNACKs++;
              if (this.paxosInstances[inst].highestNACKnum < prepNum) {
                this.paxosInstances[inst].highestNACKnum = prepNum;
              }
            }
            else {
              this.paxosInstances[inst].numNACKs = 1;
              this.paxosInstances[inst].highestNACKnum = prepNum;
            }
            if (this.paxosInstances[inst].numNACKs >= this.majorityNodes) { /* well we failed */
              if (this.paxosInstances[inst].valFromQueue) {
                this.messageQueue.unshift(this.paxosInstances[inst].value);
              }
              upgradePrepare(inst, this.paxosInstances[inst].highestNACKnum);
            }            
          }
        }
        break;
      case "AREQ":
        prepNum = +split[2];
        if (inst >= this.paxosInstances.length) { 
          for (i = this.paxosInstances.length; i < inst; i++) {
            prepareMyInstance(); /* send 0 to everyone on that instance in hopes of learning */
          }
          addPaxosInstance(inst, prepNum, from);
        }
        if (this.paxosInstances[inst].state === "Learned") {
          /* not accepting if we've already learned, send LRND */
          this.send(from, makePaxosMessage("LRND", inst, this.paxosInstances[inst].acceptedPNum,
                                                 this.paxosInstances[inst].acceptedId, null, null,
                                                 this.paxosInstances[inst].value));
        }
        else if (this.paxosInstances[inst].promiseNum < prepNum || 
                 (this.paxosInstances[inst].promiseNum === prepNum && 
                  this.paxosInstances[inst].promiseId === from)) {
          /* will accept this since haven't promised not to */
          if (this.paxosInstances[inst].hasOwnProperty('acceptedPNum') && 
              (this.paxosInstances[inst].acceptedPNum !== prepNum || this.paxosInstances[inst].acceptedId !== from)) {
            /* previously accepted something else, reset acceptor counts */
            for (i = 0; i < this.paxosInstances[inst].acceptors.length; i++) {
              this.paxosInstances[inst].acceptors[i] = 0;
              this.paxosInstances[inst].numAccepts = 0;
            }
            /* if we were the source of the previous accept, requeue value and upgrade proposal */
            if (this.paxosInstances[inst].acceptedId === this.myID) { 
              if (this.paxosInstances[inst].valFromQueue) {
                this.messageQueue.unshift(this.paxosInstances[inst].value);
              }
              upgradePrepare(inst, prepNum);
            }
          }
          this.paxosInstances[inst].promiseNum = prepNum;
          this.paxosInstances[inst].promiseId = from;
          this.paxosInstances[inst].acceptedPNum = prepNum;
          this.paxosInstances[inst].acceptedId = from;
          this.paxosInstances[inst].value = split[4];
          this.paxosInstances[inst].acceptors[this.myID] = true;
          this.paxosInstances[inst].numAccepts++;
          this.paxosInstances[inst].state = "Accepted";
          for (userId in this.userList) {
            if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
              this.send(userId, makePaxosMessage("ACPT", inst, prepNum, from, null, null,
                                                       this.paxosInstances[inst].value));
            }
          }
        }
        else { /* promised not to accept, send NACK */
          value = this.paxosInstances[inst].hasOwnProperty('value') ? this.paxosInstances[inst].value : null;
          oldProm = this.paxosInstances[inst].hasOwnProperty('acceptedPNum') ? this.paxosInstances[inst].acceptedPNum : null;
          oldId = this.paxosInstances[inst].hasOwnProperty('acceptedId') ? this.paxosInstances[inst].acceptedId : null;
          this.send(from, makePaxosMessage("NACK", inst, this.paxosInstances[inst].promiseNum, 
                                                 this.paxosInstances[inst].promiseId, oldProm, oldId, value));
        }
        break;
      case "ACPT":
        /* Play catch up if necessary */
        if (inst >= this.paxosInstances.length) {
          for (i = this.paxosInstances.length; i <= inst; i++) {
            prepareMyInstance(); /* send 0 to everyone on that instance in hopes of learning */
          }
        }
        else if (this.paxosInstances[inst].state === "Accepted") { 
          /*if the data matches, add to acceptors data and check for LRND */
          if (this.paxosInstances[inst].acceptedPNum === +split[2] && 
              this.paxosInstances[inst].acceptedId === +split[3]) {
            this.paxosInstances[inst].acceptors[from] = 1;
            this.paxosInstances[inst].numAccepts++;
            if (this.paxosInstances[inst].numAccepts >= this.majorityNodes) {
              /* yay consensus we can learn! */
              learnValue(inst, +split[2], +split[3], this.paxosInstances[inst].value);
              for (userId in this.userList) {
                if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
                  this.send(userId, makePaxosMessage("LRND", inst, +split[2], +split[3], null, null,
                                                           this.paxosInstances[inst].value));
                }
              }
            }
          }
        }
        break;
      case "LRND":
        /* Play catch up if necessary */
        if (inst >= this.paxosInstances.length) {
          for (i = this.paxosInstances.length; i < inst; i++) {
            prepareMyInstance(); /* send 0 to everyone on that instance in hopes of learning */
          }
          addPaxosInstance(inst, +split[2], +split[3]);
        }
        if (this.paxosInstances[inst].state !== "Learned") {
          learnValue(inst, +split[2], +split[3], +split[4]);
        }
        break;
      case "LRNP":
        /* For now, just learning here. */
        if (inst < this.paxosInstances.length && this.paxosInstances[inst].state !== "Learned") { /* sanity check */
          learnValue(inst, +split[4], +split[5], split[6]);
        }
        break;
      default:
        console.log("ERROR WHAT KIND OF MESSAGE WAS THAT?!");
    }
  }.bind(this));
  
  /**
  * On user profile changes, let's keep track of them
  **/
  this.social.on('onUserProfile', function (data) {
    //Just save it for now
    this.userList[data.userId] = data;
    this.updateBuddyList();
  }.bind(this));
  
  /**
  * On newly online or offline clients, let's update the roster
  **/
  this.social.on('onClientState', function (data) {
    //logger.log("roster change", data);
    if (data.status === this.social.STATUS.OFFLINE) {
      if (this.clientList.hasOwnProperty(data.clientId)) {
        delete this.clientList[data.clientId];
      }
    } else {  //Only track non-offline clients
      this.clientList[data.clientId] = data;
    }
    //If mine, send to the page
    if (this.myClientState !== null && data.clientId === this.myClientState.clientId) {
      if (data.status === this.social.STATUS.ONLINE) {
        this.dispatchEvent('recv-status', "online");
      } else {
        this.dispatchEvent('recv-status', "offline");
      }
    }
    
    this.updateBuddyList();
  }.bind(this));
};

Chat.prototype.updateBuddyList = function () {
  // Iterate over our roster and send over user profiles where there is at least 1 client online
  var buddylist = {}, k, userId;
  for (k in this.clientList) {
    if (this.clientList.hasOwnProperty(k)) {
      userId = this.clientList[k].userId;
      if (this.userList[userId]) {
        buddylist[userId] = this.userList[userId];
      }
    }
  }
  this.dispatchEvent('recv-buddylist', buddylist);
};

freedom().providePromises(Chat);
