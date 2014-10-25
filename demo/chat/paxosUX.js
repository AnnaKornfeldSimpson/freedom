/*jslint sloppy:true */
/*globals freedom, console*/

/**
 * Bind handlers on startup
 */
function start(instance) {
  var chatClient = instance(),
    // If messages are going to a specific user, store that here.
    activeBuddylistEntry,
    buddylist,
    input,
    paxosInstances = [],
    myID,
    numNodes = 3, //hardcode for now
    majorityNodes = Math.ceil(numNodes / 2),
    messageQueue = []; /* should be small, can use shift/unshift */
    
  document.getElementById('msg-input').focus();
  
  /* instNum should be contiguous, but doesn't have to be in Javascript arrays */
  function addPaxosInstance(instNum, prepareNum, idNum) {
    console.log("Starting Paxos instance" + instNum);
    paxosInstances[instNum] = newPaxosInstance(prepareNum);
    return instNum;
  }
  
  function newPaxosInstance(prepareNum, idNum) {
    this.state = "Prepared"; /* Prepared Accepted Learned */
    this.promiseNum = prepareNum;
    this.promiseId = idNum;
    this.acceptors = new Array(numNodes);
    this.numAccepts = 0;
    for (var i = 0; i < this.acceptors.length; i++) {
      this.acceptors[i] = 0;
    }
    if (idNum === myID) {
      this.promisers = new Array(numNodes);
      for(i = 0; i < this.promisers.length; i++) {
        this.promisers[i] = 0;
      }
      this.promisers[myID] = 1;
      this.numPromises = 1;
    }
  }

  /* Make a new instance with a proposal and send it to everyone */
  function prepareMyInstance() {
    var newInst = addPaxosInstance(paxosInstances.length - 1, 0, myID);

    for (var userId in buddylist) {
      if (buddylist.hasOwnProperty(userId) && userId !== myID) {
        chatClient.send(userId, makePaxosMessage("PREP", newInst, 0, myID));
      }
    }
  }
  
  /* Starting over with a new preparation number, clear promisers and wait for timeout */
  function upgradePrepare(inst, prepNum) {
    paxosInstances[inst].numPromises = 0;
    for (var i = 0; i < paxosInstances[inst].promisers.length; i++) {
      paxosInstances[inst].promisers[i] = 0;
    }
    if (paxosInstances[inst].hasOwnProperty('numNACKs')) {
      delete paxosInstances[inst].numNACKs;
      delete paxosInstances[inst].highestNACKnum;
    }
    if (paxosInstances[inst].hasOwnProperty('highestPromNum')) {
      delete paxosInstances[inst].highestPromNum;
      delete paxosInstances[inst].highestPromVal;
    }
    (function(inst, prepNum) { /*closure */
      setTimeout(function() {
        if (paxosInstances[inst].state !== "Learned") {
          var newPrepNum = Math.max(prepNum, paxosInstances[inst].promiseNum) + 1;
          paxosInstances[inst].promiseNum = newPrepNum;
          paxosInstances[inst].promiseId = myID;
          paxosInstances[inst].numPromises = 1;
          paxosInstances[inst].promisers[myID] = 1;
          for (var userId in buddylist) {
            if (buddylist.hasOwnProperty(userId) && userId !== myID) {
              chatClient.send(userId, makePaxosMessage("PREP", inst, newPrepNum, myID, null, null, null));
            }
          }
        }
      }, 15000+Math.floor(Math.random()*20000)); /* 25 seconds +- 10 seconds */
    })(inst, prepNum);
  }
  
  /* Message format: TYPE inst [[new]prepNum] [[new]idNum] [oldprepNum] [oldIdNum] [value] */
  function makePaxosMessage(type, instNum, prepNum, idNum, oldPrep, oldId, value) {
    var ret = type + " " + instNum + " ";
    if (prepNum) { 
      ret += prepNum + " ";
    }
    if (idNum) {
      ret += idNum + " ";
    }
    if (oldPrep) { 
      ret += oldPrep + " ";
    }
    if (oldId) { 
      ret += oldId + " ";
    }
    if (value) {
      ret += value;
    }
    return ret;
  }
  
  function learnValue(inst, prepNum, idNum, value) {
    if (paxosInstances[inst].hasOwnProperty('promisers')) {
      delete paxosInstances[inst].promisers;
      delete paxosInstances[inst].numPromises;
    }
    paxosInstances[inst].acceptedPNum = prepNum;
    paxosInstances[inst].acceptedId = idNum;
    paxosInstances[inst].value = value;
    paxosInstances[inst].state = "Learned";
  }
  
  function clearLog() {
    var log = document.getElementById('messagelist');
    log.innerHTML = "";
  }

  function appendLog(elt) {
    var log = document.getElementById('messagelist'),
      br;
    //Trim old messages
    while (log.childNodes.length > 36) {
      log.removeChild(log.firstChild);
    }
    log.appendChild(elt);
    br = document.createElement('br');
    log.appendChild(br);
    br.scrollIntoView();
  }

  function makeDisplayString(buddylistEntry) {
    return buddylistEntry.name && buddylistEntry.name !== buddylistEntry.userId ?
        buddylistEntry.name + ' (' + buddylistEntry.userId + ')' :
        buddylistEntry.userId;
  }

  function redrawBuddylist() {
    var onClick = function (buddylistEntry, child) {
      console.log("Messages will be sent to: " + buddylistEntry.userId);
      activeBuddylistEntry = buddylistEntry;
      redrawBuddylist();
      document.getElementById('msg-input').focus();
    },
      buddylistDiv = document.getElementById('buddylist'),
      userId,
      child;

    // Remove all elements in there now
    buddylistDiv.innerHTML = "<b>Buddylist</b>";

    // Create a new element for each buddy
    for (userId in buddylist) {
      if (buddylist.hasOwnProperty(userId)) {
        child = document.createElement('div');
        if (activeBuddylistEntry === buddylist[userId]) {
          child.innerHTML = "[" + makeDisplayString(buddylist[userId]) + "]";
        } else {
          child.innerHTML = makeDisplayString(buddylist[userId]);
        }
        // If the user clicks on a buddy, change our current destination for messages
        child.addEventListener('click', onClick.bind(this, buddylist[userId], child), true);
        buddylistDiv.appendChild(child);
      }
    }

  }
  
  // on changes to the buddylist, redraw entire buddylist
  chatClient.on('recv-buddylist', function (val) {
    buddylist = val;
    redrawBuddylist();
  });

  // Paxos logic
  chatClient.on('recv-message', function (data) {
    /* Message format: TYPE [instanceID] [pepareNum] [userId] [oldPrepareNum] [oldId] [val] */
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
        if (inst < paxosInstances.length)
        {
          if (paxosInstances[inst].hasOwnProperty('value')) {
            value = paxosInstances[inst].value;
          }
          if (paxosInstances[inst].hasOwnProperty('acceptedPNum')) {
            oldProm = paxosInstances[inst].acceptedPNum;
            oldId = paxosInstances[inst].acceptedId;
          }
          switch (paxosInstances[inst].state) {
            case 'Prepared':
              /* if prepare is higher, fix self if necessary and send PROM, else NACK */
              myPromiseNum = paxosInstances[inst].promiseNum;
              myPromiseId = paxosInstances[inst].promiseId;
              if (prepNum > myPromiseNum) {
                if (paxosInstances[inst].promiseId === myID) {
                  upgradePrepare(inst, prepNum); /* wait timeout then try to prepare again */
                }
                paxosInstances[inst].promiseNum = prepNum;
                paxosInstances[inst].promiseId = from;
                chatClient.send(from, makePaxosMessage("PROM", inst, prepNum, from, null, null, null));
              }
              else { 
                chatClient.send(from, makePaxosMessage("NACK", inst, myPromiseNum, 
                                                       paxosInstances[inst].promiseId, 
                                                       null, null, null));
              }
              break;
            case 'Accepted':
              /* if prepare is higher, send PROM, else NACK */
              myPromiseNum = paxosInstances[inst].promiseNum;
              if (prepNum > myPromiseNum) {
                paxosInstances[inst].promiseNum = prepNum;
                paxosInstances[inst].promiseId = from;
                chatClient.send(from, makePaxosMessage("PROM", inst, prepNum, from, oldProm, oldId, value));
              }
              else {
                chatClient.send(from, makePaxosMessage("NACK", inst, myPromiseNum, 
                                                       paxosInstances[inst].promiseId,
                                                       oldProm, oldId, value));
              }
              break;
            case 'Learned':
              /* if prepare is higher, send LRNP, else send LRND */
              myPromiseNum = paxosInstances[inst].promiseNum;
              if (prepNum > myPromiseNum) {
                paxosInstances[inst].promiseNum = prepNum;
                paxosInstances[inst].promiseId = from;
                chatClient.send(from, makePaxosMessage("LRNP", inst, prepNum, from, oldProm, oldId, value));
              }
              else {/* not raising promise number, would be NACK but send LRND instead */
                chatClient.send(from, makePaxosMessage("LRND", inst, myPromiseNum, 
                                                       paxosInstances[inst].promiseId, 
                                                       oldProm, oldId, value));
              }
              break;
            default:
              console.log("ERROR: Unknown state for instance " + inst + " that just received a prepare");
          }
        }
        else  { /* make a new instance, catch up if necessary and promise */
          for (i = paxosInstances.length; i < inst; i++) {
            prepareMyInstance(); /* send 0 to everyone on that instance in hopes of learning */
          }
          addPaxosInstance(inst, prepNum, from);
          chatClient.send(from, makePaxosMessage("PROM", inst, prepNum, null, null));
        }
        break;
      case 'PROM':
        /* sanity check - I had sent a prepare */
        if (inst < paxosInstances.length && paxosInstances[inst].hasOwnProperty('promisers')) {
          prepNum = +split[2];
          if (split.length > 3) {
            /* there's already a value here, keep track of it */
            oldProm = +split[4];
            value = split[6];
            if (!paxosInstances[inst].hasOwnProperty('highestPromNum') || 
                paxosInstances[inst].highestPromNum < oldProm) {
              paxosInstances[inst].highestPromNum = oldProm;
              paxosInstances[inst].highestPromVal = value;
            }
          }
          if (paxosInstances[inst].promisers[from] === false) { /* not a dup */
            paxosInstances[inst].promisers[from] = true;
            paxosInstances[inst].numPromises++;
            if (paxosInstances[inst].numPromises >= majorityNodes &&
                (paxosInstances[inst].hasOwnProperty('highestPromVal') || messageQueue.length > 0)) { 
              /* Code guarantees node will always be able to accept itself */
              var myVal;
              if (paxosInstances[inst].hasOwnProperty('highestPromVal')) {
                myVal = paxosInstances[inst].highestPromVal;
                paxosInstances[inst].valFromQueue = false;
              }
              else {
                myVal = messageQueue.shift();
                paxosInstances[inst].valFromQueue = true;
              }
              paxosInstances[inst].value = myVal;
              paxosInstances[inst].acceptors[myID] = true;
              paxosInstances[inst].numAccepts = 1;
              paxosInstances[inst].state = "Accepted";
              delete paxosInstances[inst].numPromises;
              delete paxosInstances[inst].promisers;
              if (paxosInstances[inst].hasOwnProperty('numNACKs')) {
                delete paxosInstances[inst].numNACKs;
                delete paxosInstances[inst].highestNACKnum;
              }
              if (paxosInstances[inst].hasOwnProperty('highestPromNum')) {
                delete paxosInstances[inst].highestPromNum;
                delete paxosInstances[inst].highestPromVal;
              }
              console.log("Instance " + inst + " received promises, proposing value " + myVal);
              for (userId in buddylist) {
                if (buddylist.hasOwnProperty(userId) && userId !== myID) {
                  chatClient.send(userId, makePaxosMessage("AREQ", inst, prepNum, myID, null, null, myVal));
                  chatClient.send(userId, makePaxosMessage("ACPT", inst, prepNum, myID, null, null, myVal));
                }
              }
            } /* end majority promises */
          }
        }
        break;
      case "NACK": 
        /* responding to either a prepare or an accept request */
        if (inst < paxosInstances.length && paxosInstances[inst].promiseNum < +split[2]) { /* sanity check */
          prepNum = +split[2];
          if (paxosInstances[inst].state === "Prepared" && paxosInstances[inst].promisers[from] === 0) {
            paxosInstances[inst].promisers[from] = -1;
            if (paxosInstances[inst].hasOwnProperty('numNACKs')) {
              paxosInstances[inst].numNACKs++;
              if (paxosInstances[inst].highestNACKnum < prepNum) {
                paxosInstances[inst].highestNACKnum = prepNum;
              }
            }
            else {
              paxosInstances[inst].numNACKs = 1;
              paxosInstances[inst].highestNACKnum = prepNum;
            }
            if (paxosInstances[inst].numNACKs >= majorityNodes) { /* well we failed */
              upgradePrepare(inst, paxosInstances[inst].highestNACKnum);
            }            
          }
          else if (paxosInstances[inst].state === "Accepted" && 
                   paxosInstances[inst].acceptors[from] === 0) {
            /* Add to NACKS, if majority, requeue value if necessary and upgrade prepare */
            paxosInstances[inst].acceptors[from] = -1;
            if (paxosInstances[inst].hasOwnProperty('numNACKs')) {
              paxosInstances[inst].numNACKs++;
              if (paxosInstances[inst].highestNACKnum < prepNum) {
                paxosInstances[inst].highestNACKnum = prepNum;
              }
            }
            else {
              paxosInstances[inst].numNACKs = 1;
              paxosInstances[inst].highestNACKnum = prepNum;
            }
            if (paxosInstances[inst].numNACKs >= majorityNodes) { /* well we failed */
              if (paxosInstances[inst].valFromQueue) {
                messageQueue.unshift(paxosInstances[inst].value);
              }
              upgradePrepare(inst, paxosInstances[inst].highestNACKnum);
            }            
          }
        }
        break;
      case "AREQ":
        prepNum = +split[2];
        if (inst >= paxosInstances.length) { 
          for (i = paxosInstances.length; i < inst; i++) {
            prepareMyInstance(); /* send 0 to everyone on that instance in hopes of learning */
          }
          addPaxosInstance(inst, prepNum, from);
        }
        if (paxosInstances[inst].state === "Learned") {
          /* not accepting if we've already learned, send LRND */
          chatClient.send(from, makePaxosMessage("LRND", inst, paxosInstances[inst].acceptedPNum,
                                                 paxosInstances[inst].acceptedId, null, null,
                                                 paxosInstances[inst].value));
        }
        else if (paxosInstances[inst].promiseNum < prepNum || 
                 (paxosInstances[inst].promiseNum === prepNum && 
                  paxosInstances[inst].promiseId === from)) {
          /* will accept this since haven't promised not to */
          if (paxosInstances[inst].hasOwnProperty('acceptedPNum') && 
              (paxosInstances[inst].acceptedPNum !== prepNum || paxosInstances[inst].acceptedId !== from)) {
            /* previously accepted something else, reset acceptor counts */
            for (i = 0; i < paxosInstances[inst].acceptors.length; i++) {
              paxosInstances[inst].acceptors[i] = 0;
              paxosInstances[inst].numAccepts = 0;
            }
            /* if we were the source of the previous accept, requeue value and upgrade proposal */
            if (paxosInstances[inst].acceptedId === myID) { 
              if (paxosInstances[inst].valFromQueue) {
                messageQueue.unshift(paxosInstances[inst].value);
              }
              upgradePrepare(inst, prepNum);
            }
          }
          paxosInstances[inst].promiseNum = prepNum;
          paxosInstances[inst].promiseId = from;
          paxosInstances[inst].acceptedPNum = prepNum;
          paxosInstances[inst].acceptedId = from;
          paxosInstances[inst].value = split[4];
          paxosInstances[inst].acceptors[myID] = true;
          paxosInstances[inst].numAccepts++;
          paxosInstances[inst].state = "Accepted";
          for (userId in buddylist) {
            if (buddylist.hasOwnProperty(userId) && userId !== myID) {
              chatClient.send(userId, makePaxosMessage("ACPT", inst, prepNum, from, null, null,
                                                       paxosInstances[inst].value));
            }
          }
        }
        else { /* promised not to accept, send NACK */
          value = paxosInstances[inst].hasOwnProperty('value') ? paxosInstances[inst].value : null;
          oldProm = paxosInstances[inst].hasOwnProperty('acceptedPNum') ? paxosInstances[inst].acceptedPNum : null;
          oldId = paxosInstances[inst].hasOwnProperty('acceptedId') ? paxosInstances[inst].acceptedId : null;
          chatClient.send(from, makePaxosMessage("NACK", inst, paxosInstances[inst].promiseNum, 
                                                 paxosInstances[inst].promiseId, oldProm, oldId, value));
        }
        break;
      case "ACPT":
        /* Play catch up if necessary */
        if (inst >= paxosInstances.length) {
          for (i = paxosInstances.length; i <= inst; i++) {
            prepareMyInstance(); /* send 0 to everyone on that instance in hopes of learning */
          }
        }
        else if (paxosInstances[inst].state === "Accepted") { 
          /*if the data matches, add to acceptors data and check for LRND */
          if (paxosInstances[inst].acceptedPNum === +split[2] && 
              paxosInstances[inst].acceptedId === +split[3]) {
            paxosInstances[inst].acceptors[from] = 1;
            paxosInstances[inst].numAccepts++;
            if (paxosInstances[inst].numAccepts >= majorityNodes) {
              /* yay consensus we can learn! */
              learnValue(inst, +split[2], +split[3], paxosInstances[inst].value);
              appendLog(document.createTextNode("Learning instance: " + inst + " value: " + paxosInstances[inst].value));
              for (userId in buddylist) {
                if (buddylist.hasOwnProperty(userId) && userId !== myID) {
                  chatClient.send(userId, makePaxosMessage("LRND", inst, +split[2], +split[3], null, null,
                                                           paxosInstances[inst].value));
                }
              }
            }
          }
        }
        break;
      case "LRND":
        /* Play catch up if necessary */
        if (inst >= paxosInstances.length) {
          for (i = paxosInstances.length; i < inst; i++) {
            prepareMyInstance(); /* send 0 to everyone on that instance in hopes of learning */
          }
          addPaxosInstance(inst, +split[2], +split[3]);
        }
        if (paxosInstances[inst].state !== "Learned") {
          learnValue(inst, +split[2], +split[3], +split[4]);
          appendLog(document.createTextNode("Learning instance: " + inst + " value: " + value));
        }
        break;
      case "LRNP":
        /* For now, just learning here. */
        if (inst < paxosInstances.length && paxosInstances[inst].state !== "Learned") { /* sanity check */
          learnValue(inst, +split[4], +split[5], split[6]);
          appendLog(document.createTextNode("Learning instance: " + inst + " value: " + value));
        }
        break;
      default:
        console.log("ERROR WHAT KIND OF MESSAGE WAS THAT?!");
    }
    appendLog(document.createTextNode(data.message));
  });
  
  // On new messages, append it to our message log
  chatClient.on('recv-err', function (data) {
    document.getElementById('uid').textContent = "Error: " + data.message;
  });

  // Display our own userId when we get it
  chatClient.on('recv-uid', function (data) {
    myID = +data;
    document.getElementById('uid').textContent = "Logged in as: " + data;
  });

  // Display the current status of our connection to the Social provider
  chatClient.on('recv-status', function (msg) {
    if (msg && msg === 'online') {
      document.getElementById('msg-input').disabled = false;
    } else {
      document.getElementById('msg-input').disabled = true;
    }
    clearLog();
    var elt = document.createElement('b');
    elt.appendChild(document.createTextNode('Status: ' + msg));
    appendLog(elt);
  });

  // Listen for the enter key and send messages on return
  input = document.getElementById('msg-input');
  input.onkeydown = function (evt) {
    if (evt.keyCode === 13) {
      var text = input.value;
      input.value = "";
      messageQueue.push(text);
      appendLog(document.createTextNode("Your request was enqueued: " + text));
      prepareMyInstance();
    }
  };
}

window.onload = function () {
  freedom('manifest.json').then(start);
};
