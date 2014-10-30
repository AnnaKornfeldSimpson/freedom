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
Chat.prototype.makePaxosMessage = function(type, instNum, prepNum, idNum, oldPrep, oldId, value) {
    var msg = type + " " + instNum;
    if (prepNum !== undefined && prepNum !== null) {
      msg += " " + prepNum;
      msg += " " + idNum;
    }
    if (oldPrep !== undefined && oldPrep !== null) {
      msg += " " + oldPrep;
      msg += " " + oldId;
    }
    if (value !== undefined && value !== null) {
      msg += " " + value;
    }
  //console.log("MakePaxosMessage: " + msg);
  return msg;
};

Chat.prototype.parsePaxosMessage = function(msg) {
  var split = msg.split(' ');
  console.log("Parsing paxos message with " + split.length + " elements: " + msg);
  var parsed = {type: split[0], inst: +split[1]};
  if (split.length >= 4) {
    /* both a prepnum and prepid */
    parsed.prepNum = +split[2];
    parsed.prepId = split[3];
  }
  else if (split.length === 3) {
    parsed.value = split[2];
  }
  if (split.length === 7) {
    parsed.oldPrep = +split[4];
    parsed.oldId = split[5];
    parsed.value = split[6];
  }
  else {
    parsed.value = split[4];
  }
  return parsed;
};

/* Constructor for paxos instances */
Chat.prototype.newPaxosInstance = function(prepareNum, idNum) {
    this.state = "Prepared"; /* Prepared Accepted Learned */
    this.promiseNum = prepareNum;
    this.promiseId = idNum;
    this.acceptors = {};
    this.numAccepts = 0;
    if (idNum === this.myID) {
      this.promisers = {};
      this.promisers[this.myID] = 1;
      this.numPromises = 1;
    }
  };

/* instNum should be contiguous, but doesn't have to be in Javascript arrays */
Chat.prototype.addPaxosInstance = function(instNum, prepareNum, idNum) {
    console.log("Starting Paxos instance: " + instNum + " by " + idNum);
    if (instNum < 0) {
      instNum = 0;
    }
    this.paxosInstances[instNum] = {
      state: "Prepared",
      promiseNum: prepareNum,
      promiseId: idNum,
      acceptors: {},
      numAccepts: 0,
      promisers: {},
      numPromises: 1
    };
    this.paxosInstances[instNum].promisers[idNum] = 1;

    return instNum;
  };

  /* Make a new instance with a proposal and send it to everyone */
Chat.prototype.prepareMyInstance = function() {
    var newInst = this.addPaxosInstance(this.paxosInstances.length, 0, this.myID);
    var res, msg;
    for (var userId in this.userList) {
      if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
        msg = this.makePaxosMessage("PREP", newInst, 0, this.myID, null, null, null);
        //console.log("prepareInstance sending msg: " + msg);
        res = this.send(userId, msg);
      }
    }
    
    console.log("New instance " + newInst + " from " + this.myID + " sent " + msg);
    return res;
  };
  
Chat.prototype.enqueue = function(message) {
 /* What the UI now calls instead of send when there's a new message */
  this.messageQueues[2].push(message);
  return this.prepareMyInstance();
};
  
  /* Starting over with a new preparation number, clear promisers and wait for timeout */
Chat.prototype.upgradePrepare = function(inst, prepNum) {
    this.paxosInstances[inst].numPromises = 0;
    this.paxosInstances[inst].promisers = {};
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
        if (this.paxosInstances[inst].state !== "Learned" && this.paxosInstances[inst].promiseId !== myID) {
          var newPrepNum = Math.max(prepNum, this.paxosInstances[inst].promiseNum) + 1;
          console.log("Upgrading proposal for instance " + inst + " with prepNum " + newPrepNum);
          this.paxosInstances[inst].promiseNum = newPrepNum;
          this.paxosInstances[inst].promiseId = this.myID;
          this.paxosInstances[inst].numPromises = 1;
          this.paxosInstances[inst].promisers = {};
          this.paxosInstances[inst].promisers[this.myID] = 1;
          for (var userId in this.userList) {
            if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
              this.send(userId, this.makePaxosMessage("PREP", inst, newPrepNum, this.myID, null, null, null));
            }
          }
        }
      }.bind(this), 15000+Math.floor(Math.random()*60000)); /* 45 seconds +- 30 seconds */
    }.bind(this))(inst, prepNum);
  };
  
Chat.prototype.learnValue = function(inst, prepNum, idNum, value) {
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
    console.log("Dispatching to client: " + value + " from: " + idNum + " inst" + inst);
    this.dispatchEvent('recv-message', {message: value, from: idNum, inst: inst});
  };

/** 
 * sent messages are enqueued, then the social provider is called from the logic
 **/
 
Chat.prototype.send = function (to, message) {
  return this.social.sendMessage(to, message);
};

Chat.prototype.boot = function () {
  this.social.login({
    agent: 'chatdemo2.0',
    version: '0.1',
    //url: 'https://script.google.com/macros/s/AKfycbzHnARyAwRt-qkQv67KMY1FwDImaj3eRSQVUV_6KLwa5cQ1YFc/exec',
    url: 'https://script.google.com/macros/s/AKfycbzzC1VmN2HKpIGNPQ_yDc4qlSEptDm_EOuOr9ArGF0ULXxTFeM/exec',
    interactive: true,
    rememberLogin: false
  }).then(function (ret) {
    this.myClientState = ret;
    this.myID = ret.userId;
    logger.log("onLogin ID: " + this.myID, this.myClientState);
    if (ret.status === this.social.STATUS.ONLINE) {
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
    var from = data.from.userId,
      parsed = this.parsePaxosMessage(data.message),
      myPromiseId,
      myPromiseNum, 
      i, 
      userId;
    console.log("Received " + data.message + " from " + from);
    switch(parsed.type)
    {
      case 'PREP':
        if (parsed.inst < this.paxosInstances.length)
        {
          switch (this.paxosInstances[parsed.inst].state) {
            case 'Prepared':
              /* if prepare is higher, fix self if necessary and send PROM, else NACK */
              myPromiseNum = this.paxosInstances[parsed.inst].promiseNum;
              myPromiseId = this.paxosInstances[parsed.inst].promiseId;
              if (parsed.prepNum > myPromiseNum) {
                if (this.paxosInstances[parsed.inst].promiseId === this.myID) {
                  this.upgradePrepare(parsed.inst, parsed.prepNum); /* wait timeout then try to prepare again */
                }
                this.paxosInstances[parsed.inst].promiseNum = parsed.prepNum;
                this.paxosInstances[parsed.inst].promiseId = from;
                this.send(from, this.makePaxosMessage("PROM", parsed.inst, parsed.prepNum, 
                                                      from, null, null, null));
              }
              else { 
                this.send(from, this.makePaxosMessage("NACK", parsed.inst, myPromiseNum, 
                                                      myPromiseId, null, null, null));
              }
              break;
            case 'Accepted':
              /* if prepare is higher, send PROM, else NACK */
              myPromiseNum = this.paxosInstances[parsed.inst].promiseNum;
              if (parsed.prepNum > myPromiseNum) {
                this.paxosInstances[parsed.inst].promiseNum = parsed.prepNum;
                this.paxosInstances[parsed.inst].promiseId = from;
                this.send(from, this.makePaxosMessage("PROM", parsed.inst, parsed.prepNum, from, 
                                                      this.paxosInstances[parsed.inst].promiseNum, 
                                                      this.paxosInstances[parsed.inst].promiseId,
                                                      this.paxosInstances[parsed.inst].value));
              }
              else {
                this.send(from, this.makePaxosMessage("NACK", parsed.inst, myPromiseNum, 
                                                       this.paxosInstances[parsed.inst].promiseId,
                                                       this.paxosInstances[parsed.inst].acceptedPNum, 
                                                       this.paxosInstances[parsed.inst].acceptedId, 
                                                       this.paxosInstances[parsed.inst].value));
              }
              break;
            case 'Learned':
              /* if prepare is higher, send LRNP, else send LRND */
              myPromiseNum = this.paxosInstances[parsed.inst].promiseNum;
              if (parsed.prepNum > myPromiseNum) {
                this.paxosInstances[parsed.inst].promiseNum = parsed.prepNum;
                this.paxosInstances[parsed.inst].promiseId = from;
                this.send(from, this.makePaxosMessage("LRNP", parsed.inst, parsed.prepNum, 
                                                      from, parsed.oldProm, parsed.oldId, 
                                                      parsed.value));
              }
              else {/* not raising promise number, would be NACK but send LRND parsed.instead */
                this.send(from, this.makePaxosMessage("LRND", parsed.inst, myPromiseNum, 
                                                       this.paxosInstances[parsed.inst].promiseId, 
                                                       this.paxosInstances[parsed.inst].acceptedPNum, 
                                                       this.paxosInstances[parsed.inst].acceptedId, 
                                                       this.paxosInstances[parsed.inst].value));
              }
              break;
            default:
              console.log("ERROR: Unknown state for parsed.instance " + parsed.inst + " that just received a prepare");
          }
        }
        else  { /* make a new parsed.instance, catch up if necessary and promise */
          for (i = this.paxosInstances.length; i < parsed.inst; i++) {
            this.prepareMyInstance(); /* send 0 to everyone on that parsed.instance in hopes of learning */
          }
          this.addPaxosInstance(parsed.inst, parsed.prepNum, from);
          this.send(from, this.makePaxosMessage("PROM", parsed.inst, parsed.prepNum, from, 
                                                null, null, null));
        }
        break;
      case 'PROM':
        /* sanity check - I had sent a prepare */
        if (parsed.inst < this.paxosInstances.length && 
            this.paxosInstances[parsed.inst].state === "Prepared") {
            //console.log("PROM: yay I am sane " + parsed.inst);
          if (parsed.hasOwnProperty('oldProm') && 
              (!this.paxosInstances[parsed.inst].hasOwnProperty('highestPromNum') || 
                this.paxosInstances[parsed.inst].highestPromNum < parsed.oldProm)) {
            this.paxosInstances[parsed.inst].highestPromNum = parsed.oldProm;
            this.paxosInstances[parsed.inst].highestPromId = parsed.oldId;
            this.paxosInstances[parsed.inst].highestPromVal = parsed.value;
          }
          if (!this.paxosInstances[parsed.inst].promisers.hasOwnProperty(from)) { /* not a dup */
            this.paxosInstances[parsed.inst].promisers[from] = 1;
            this.paxosInstances[parsed.inst].numPromises++;
            console.log("Inst " + parsed.inst + " has now received " + this.paxosInstances[parsed.inst].numPromises + " promises.");
            if (this.paxosInstances[parsed.inst].numPromises >= this.majorityNodes &&
                (this.paxosInstances[parsed.inst].hasOwnProperty('highestPromVal') || 
                  this.messageQueues[2].length > 0)) { 
              /* Code guarantees node will always be able to accept itself */
              var myVal;
              console.log("Hooray we have reached a majority of " + this.majorityNodes + " for inst: " + parsed.inst);
              if (this.paxosInstances[parsed.inst].hasOwnProperty('highestPromVal')) {
                myVal = this.paxosInstances[parsed.inst].highestPromVal;
                this.paxosInstances[parsed.inst].valFromQueue = false;
              }
              else {
                myVal = this.messageQueues[2].shift();
                this.paxosInstances[parsed.inst].valFromQueue = true;
              }
              this.paxosInstances[parsed.inst].acceptedPNum = parsed.prepNum;
              this.paxosInstances[parsed.inst].acceptedId = this.myID;
              this.paxosInstances[parsed.inst].value = myVal;
              this.paxosInstances[parsed.inst].acceptors[this.myID] = true;
              this.paxosInstances[parsed.inst].numAccepts = 1;
              this.paxosInstances[parsed.inst].state = "Accepted";
              delete this.paxosInstances[parsed.inst].numPromises;
              delete this.paxosInstances[parsed.inst].promisers;
              if (this.paxosInstances[parsed.inst].hasOwnProperty('numNACKs')) {
                delete this.paxosInstances[parsed.inst].numNACKs;
                delete this.paxosInstances[parsed.inst].highestNACKnum;
              }
              if (this.paxosInstances[parsed.inst].hasOwnProperty('highestPromNum')) {
                delete this.paxosInstances[parsed.inst].highestPromNum;
                delete this.paxosInstances[parsed.inst].highestPromVal;
              }
              console.log("Instance " + parsed.inst + " received promises, proposing value " + myVal);
              for (userId in this.userList) {
                if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
                  this.send(userId, this.makePaxosMessage("AREQ", parsed.inst, parsed.prepNum, 
                                                          this.myID, null, null, myVal));
                  this.send(userId, this.makePaxosMessage("ACPT", parsed.inst, parsed.prepNum, 
                                                          this.myID, null, null, myVal));
                }
              }
            } /* end majority promises */
          }
        }
        break;
      case "NACK": 
        /* responding to either a prepare or an accept request */
        if (parsed.inst < this.paxosInstances.length && 
            this.paxosInstances[parsed.inst].promiseNum <= parsed.prepNum) { /* sanity check */
            //console.log("NACK yay I am sane " + parsed.inst + " state: " + this.paxosInstances[parsed.inst].state);
          if (this.paxosInstances[parsed.inst].state === "Prepared" && 
              !this.paxosInstances[parsed.inst].promisers.hasOwnProperty(from)) {
              console.log("Counting this NACK from " + from);
            this.paxosInstances[parsed.inst].promisers[from] = -1;
            if (this.paxosInstances[parsed.inst].hasOwnProperty('numNACKs')) {
              this.paxosInstances[parsed.inst].numNACKs++;
              if (this.paxosInstances[parsed.inst].highestNACKnum < parsed.prepNum) {
                this.paxosInstances[parsed.inst].highestNACKnum = parsed.prepNum;
              }
            }
            else {
              this.paxosInstances[parsed.inst].numNACKs = 1;
              this.paxosInstances[parsed.inst].highestNACKnum = parsed.prepNum;
            }
            if (this.paxosInstances[parsed.inst].numNACKs >= this.majorityNodes) { /* well we failed */
              console.log("Too many NACKs received, upgrading proposal for " + parsed.inst + " was " + parsed.prepNum);
              this.upgradePrepare(parsed.inst, this.paxosInstances[parsed.inst].highestNACKnum);
            }
            else { /* haven't failed yet, but do want to check back */
              (function(inst, state, numNACKs) { /*closure */
                setTimeout(function() {
                  /* if we're still in limbo, upgrade proposal */
                  if (this.paxosInstances[inst].state === state && 
                      this.paxosInstances[inst].hasOwnProperty('numNACKs') &&
                      this.paxosInstances[inst].numNACKs >= numNACKs) {
                    console.log("Still stuck in NACK limbo, upgrading proposal for " + inst);
                    this.upgradePrepare(inst, this.paxosInstances[inst].highestNACKnum);
                  }
                }.bind(this), 10000+Math.floor(Math.random()*10000)); /* 15 seconds +- 5 seconds */
              }.bind(this))(parsed.inst, this.paxosInstances[parsed.inst].state, this.paxosInstances[parsed.inst].numNACKs);
            }
          }
          else if (this.paxosInstances[parsed.inst].state === "Accepted" && 
                   !this.paxosInstances[parsed.inst].acceptors.hasOwnProperty(from)) {
            /* Add to NACKS, if majority, requeue value if necessary and upgrade prepare */
            this.paxosInstances[parsed.inst].acceptors[from] = -1;
            if (this.paxosInstances[parsed.inst].hasOwnProperty('numNACKs')) {
              this.paxosInstances[parsed.inst].numNACKs++;
              if (this.paxosInstances[parsed.inst].highestNACKnum < parsed.prepNum) {
                this.paxosInstances[parsed.inst].highestNACKnum = parsed.prepNum;
              }
            }
            else {
              this.paxosInstances[parsed.inst].numNACKs = 1;
              this.paxosInstances[parsed.inst].highestNACKnum = parsed.prepNum;
            }
            if (this.paxosInstances[parsed.inst].numNACKs >= this.majorityNodes) { /* well we failed */
              if (this.paxosInstances[parsed.inst].valFromQueue) {
                this.messageQueue.unshift(this.paxosInstances[parsed.inst].value);
              }
              this.upgradePrepare(parsed.inst, this.paxosInstances[parsed.inst].highestNACKnum);
            }
            else { /* haven't failed yet, but do want to check back */
              (function(inst, state, numNACKs) { /*closure */
                setTimeout(function() {
                  /* if we're still in limbo, upgrade proposal */
                  if (this.paxosInstances[inst].state === state && 
                      this.paxosInstances[inst].hasOwnProperty('numNACKs') &&
                      this.paxosInstances[inst].numNACKs >= numNACKs) {
                    console.log("Still stuck in NACK limbo, upgrading proposal for " + inst);
                    this.upgradePrepare(inst, this.paxosInstances[inst].highestNACKnum);
                  }
                }.bind(this), 10000+Math.floor(Math.random()*10000)); /* 15 seconds +- 5 seconds */
              }.bind(this))(parsed.inst, this.paxosInstances[parsed.inst].state, this.paxosInstances[parsed.inst].numNACKs);
            }
          }
        }
        break;
      case "AREQ":
        if (parsed.inst >= this.paxosInstances.length) { 
          for (i = this.paxosInstances.length; i < parsed.inst; i++) {
            this.prepareMyInstance(); /* send 0 to everyone on that parsed.instance in hopes of learning */
          }
          this.addPaxosInstance(parsed.inst, parsed.prepNum, from);
        }
        if (this.paxosInstances[parsed.inst].state === "Learned") {
          /* not accepting if we've already learned, send LRND */
          this.send(from, this.makePaxosMessage("LRND", parsed.inst, 
                                                this.paxosInstances[parsed.inst].acceptedPNum,
                                                this.paxosInstances[parsed.inst].acceptedId, 
                                                null, null,
                                                this.paxosInstances[parsed.inst].value));
        }
        else if (this.paxosInstances[parsed.inst].promiseNum < parsed.prepNum || 
                 (this.paxosInstances[parsed.inst].promiseNum === parsed.prepNum && 
                  this.paxosInstances[parsed.inst].promiseId === from)) {
          /* haven't promised not to accept */
          if (this.paxosInstances[parsed.inst].hasOwnProperty('acceptedPNum') && 
              (this.paxosInstances[parsed.inst].acceptedPNum !== parsed.prepNum || 
                this.paxosInstances[parsed.inst].acceptedId !== from)) {
            /* previously accepted something else, reset acceptor counts */
            this.paxosInstances[parsed.inst].acceptors = {};
            this.paxosInstances[parsed.inst].numAccepts = 0;
            /* if we were the source of the previous accept, requeue value and upgrade proposal */
            if (this.paxosInstances[parsed.inst].promiseId === this.myID || this.paxosInstances[parsed.inst].acceptedId === this.myID) { 
              if (this.paxosInstances[parsed.inst].acceptedId === this.myID && this.paxosInstances[parsed.inst].valFromQueue) {
                this.messageQueue.unshift(this.paxosInstances[parsed.inst].value);
              }
              /* accept but then we're going to upgrade */
              for (userId in this.userList) {
                if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
                  this.send(userId, this.makePaxosMessage("ACPT", parsed.inst, parsed.prepNum, 
                                                          from, null, null,
                                                          this.paxosInstances[parsed.inst].value));
                }
              }
              this.upgradePrepare(parsed.inst, parsed.prepNum); 
            }
            else { /* otherwise we'll be accepting */
              this.paxosInstances[parsed.inst].promiseNum = parsed.prepNum;
              this.paxosInstances[parsed.inst].promiseId = from;
              this.paxosInstances[parsed.inst].acceptedPNum = parsed.prepNum;
              this.paxosInstances[parsed.inst].acceptedId = from;
              this.paxosInstances[parsed.inst].value = parsed.value;
              this.paxosInstances[parsed.inst].acceptors[this.myID] = true;
              this.paxosInstances[parsed.inst].numAccepts++;
              /* could add logic here that assumes REQ also accepted and learn if majority */
              this.paxosInstances[parsed.inst].state = "Accepted";
              for (userId in this.userList) {
                if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
                  this.send(userId, this.makePaxosMessage("ACPT", parsed.inst, parsed.prepNum, 
                                                          from, null, null,
                                                          this.paxosInstances[parsed.inst].value));
                }
              }
            }
          }
        }
        else { /* promised not to accept, send NACK */
          this.send(from, this.makePaxosMessage("NACK", parsed.inst, 
                                                this.paxosInstances[parsed.inst].promiseNum, 
                                                this.paxosInstances[parsed.inst].promiseId, 
                                                this.paxosInstances[parsed.inst].acceptedPNum, 
                                                this.paxosInstances[parsed.inst].acceptedId, 
                                                this.paxosInstances[parsed.inst].value));
        }
        break;
      case "ACPT":
        /* Play catch up if necessary */
        if (parsed.inst >= this.paxosInstances.length) {
          for (i = this.paxosInstances.length; i < parsed.inst; i++) {
            this.prepareMyInstance(); /* send 0 to everyone on that parsed.instance in hopes of learning */
          }
          this.addPaxosInstance(parsed.inst, parsed.prepNum, parsed.prepId);
        }
        else if (this.paxosInstances[parsed.inst].state === "Accepted" && 
                (this.paxosInstances[parsed.inst].acceptedPNum === parsed.prepNum && 
              this.paxosInstances[parsed.inst].acceptedId === parsed.prepId)) { 
          /*if the data matches, add to acceptors data and check for LRND */
          this.paxosInstances[parsed.inst].acceptors[from] = 1;
          this.paxosInstances[parsed.inst].numAccepts++;
          console.log("Accepts for " + parsed.inst + " now " + this.paxosInstances[parsed.inst].numAccepts);
          if (this.paxosInstances[parsed.inst].numAccepts >= this.majorityNodes) {
            /* yay consensus we can learn! */
            console.log("More than " + this.majorityNodes + " agree, we can learn inst: " + parsed.inst);
            this.learnValue(parsed.inst, parsed.prepNum, parsed.prepId, this.paxosInstances[parsed.inst].value);
            for (userId in this.userList) {
              if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
                this.send(userId, this.makePaxosMessage("LRND", parsed.inst, parsed.prepNum,
                                                        parsed.prepId, null, null,
                                                        this.paxosInstances[parsed.inst].value));
              }
            }
          }
        }
        else if (this.paxosInstances[parsed.inst].state === "Prepared" && 
                (this.paxosInstances[parsed.inst].promiseNum === parsed.prepNum && 
                  this.paxosInstances[parsed.inst].promiseId === parsed.prepId)) {
          this.paxosInstances[parsed.inst].acceptedPNum = parsed.prepNum;
          this.paxosInstances[parsed.inst].acceptedId = parsed.prepId;
          this.paxosInstances[parsed.inst].state = "Accepted";
          this.paxosInstances[parsed.inst].value = parsed.value;
          this.paxosInstances[parsed.inst].acceptors[from] = 1;
          this.paxosInstances[parsed.inst].numAccepts = 2;
          console.log("We have now accepted for inst " + parsed.inst);
          if (this.paxosInstances[parsed.inst].numAccepts >= this.majorityNodes) {
            /* yay consensus we can learn! */
            console.log("More than " + this.majorityNodes + " agree, we can learn inst: " + parsed.inst);
            this.learnValue(parsed.inst, parsed.prepNum, parsed.prepId, this.paxosInstances[parsed.inst].value);
            for (userId in this.userList) {
              if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
                this.send(userId, this.makePaxosMessage("LRND", parsed.inst, parsed.prepNum,
                                                        parsed.prepId, null, null,
                                                        this.paxosInstances[parsed.inst].value));
              }
            }
          }
          else { /* send our own accept */
            for (userId in this.userList) {
              if (this.userList.hasOwnProperty(userId) && userId !== this.myID) {
                this.send(userId, this.makePaxosMessage("ACPT", parsed.inst, parsed.prepNum, 
                                                        from, null, null,
                                                        parsed.value));
              }
            }
          }
        }
        break;
      case "LRND":
        /* Play catch up if necessary */
        if (parsed.inst >= this.paxosInstances.length) {
          for (i = this.paxosInstances.length; i < parsed.inst; i++) {
            this.prepareMyInstance(); /* send 0 to everyone on that parsed.instance in hopes of learning */
          }
          this.addPaxosInstance(parsed.inst, parsed.prepNum, parsed.prepId);
        }
        if (this.paxosInstances[parsed.inst].state !== "Learned") {
          if (this.paxosInstances[parsed.inst].acceptedId === this.myID && parsed.prepId !== this.myID) {
            /* re-enqueue value and start new instance */
            if (this.paxosInstances[parsed.inst].valFromQueue) {
              this.messageQueue.unshift(this.paxosInstances[parsed.inst].value);
            }
            this.prepareMyInstance();
          }
          else if (this.paxosInstances[parsed.inst].promiseId === this.myID && 
                   this.messageQueues[2].length > 0) {
            /* start a new instance for whatever we were trying to promise */
            this.prepareMyInstance();
          }
          console.log("Hooray we're learning " + parsed.inst + " value: " + parsed.value);
          this.learnValue(parsed.inst, parsed.prepNum, parsed.prepId, parsed.value);
        }
        break;
      case "LRNP":
        /* For now, just learning here. */
        if (parsed.inst < this.paxosInstances.length && this.paxosInstances[parsed.inst].state !== "Learned") { /* sanity check */
          this.learnValue(parsed.inst, parsed.oldPrep, parsed.oldId, parsed.value);
          this.prepareMyInstance(); /* try again for the value elsewhere */
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
    console.log("onUserProfile " + data.userId);
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
