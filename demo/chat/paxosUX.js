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
  
  function addPaxosInstance(instNum, prepareNum, idNum) {
    console.log("Starting Paxos instance" + instNum);
    paxosInstances[instNum] = newPaxosInstance(prepareNum);
    return instNum;
  }
  function newPaxosInstance(prepareNum, idNum) {
    this.state = "Prepared";
    this.prepareNum = prepareNum;
    this.idNum = idNum;
    this.acceptors = new Array(numNodes);
    this.numAccepts = 0;
    for (var i = 0; i < this.acceptors.length; i++) {
      this.acceptors[i] = false;
    }
    if (idNum === myID) {
      this.promisers = new Array(numNodes);
      for(i = 0; i < this.promisers.length; i++) {
        this.promisers[i] = false;
      }
      this.promisers[myID] = true;
      this.numPromises = 1;
    }
  }

  function makePaxosMessage(type, instNum, prepNum, idNum, value) {
    var ret = type + " " + instNum + " ";
    if (prepNum) { 
      ret += prepNum + " ";
    }
    if (idNum) {
      ret += idNum + " ";
    }
    if (value) {
      ret += value;
    }
    return ret;
  }
  
  function prepareMyInstance() {
    var newInst = addPaxosInstance(paxosInstances.length - 1, 0, myID);

    for (var userId in buddylist) {
      if (buddylist.hasOwnProperty(userId) && userId !== myID) {
        chatClient.send(userId, makePaxosMessage("PREP", newInst, 0, myID));
      }
    }
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

  // On new messages, append it to our message log
  chatClient.on('recv-message', function (data) {
    /* Message format: TYPE [instanceID] [pepareNum] [userId] [val] */
    var from = +data.from.userId,
      split = data.message.split(' '), 
      type = split[0],
      inst = +split[1], 
      prepNum, 
      value;
    console.log("Received " + data.message + " from " + from);
    switch(type)
    {
      case 'PREP':
        prepNum = +split[2];
        if (inst < paxosInstances.length)
        {
          value = null;
          if (paxosInstances[inst].hasOwnProperty('value')) {
            value = paxosInstances[inst].value;
          }
          
          /* Assumes will never receive a prepare with a lower prepNum from same proposer */
          if (prepNum < paxosInstances[inst].prepareNum || from !== paxosInstances[inst].idNum) {
            /* send NACK, someone has that number or higher */
            chatClient.send(from, makePaxosMessage("NACK", inst, paxosInstances[inst].prepareNum, null, value));
          }
          else {
            /* set state, and send PROM */
            paxosInstances[inst].prepareNum = prepNum;
            
            if (!value) {
              paxosInstances[inst].idNum = from;
            }
            
            if (paxosInstances[inst].hasOwnProperty('promisers')) {
              /* we're no longer promising ourselves, start a new instance */
              delete paxosInstances[inst].promisers;
              delete paxosInstances[inst].numPromises;
              prepareMyInstance();
            }
            
            chatClient.send(from, makePaxosMessage("PROM", inst, prepNum, null, value));
          }
        }
        else  { /* make a new instance and promise */
          addPaxosInstance(inst, prepNum, from);
          chatClient.send(from, makePaxosMessage("PROM", inst, prepNum, null, null));
        }
        break;
      case 'PROM':
        /* sanity check */
        if (inst < paxosInstances.length && paxosInstances[inst].hasOwnProperty('promisers')) {
          prepNum = +split[2];
          if (split.length > 3) {
            /* there's already a value here, learn it and retry on a different instance */
            value = split[3];
            paxosInstances[inst].value = value;
            paxosInstances[inst].state = "Learned";
            delete paxosInstances[inst].promisers;
            delete paxosInstances[inst].numPromises;
            delete paxosInstances[inst].acceptors;
            delete paxosInstances[inst].numAccepts;
            prepareMyInstance();
          }
          else if (paxosInstances[inst].promisers[from] === false) { /* new promise */
            paxosInstances[inst].promisers[from] = true;
            paxosInstances[inst].numPromises++;
            if (paxosInstances[inst].numPromises >= majorityNodes)
            {
              var myVal = messageQueue.shift();
              paxosInstances[inst].value = myVal;
              paxosInstances[inst].acceptors[myID] = true;
              paxosInstances[inst].numAccepts++;
              delete paxosInstances[inst].numPromises;
              delete paxosInstances[inst].promisers;
              console.log("Instance " + inst + " received promises, proposing value " + myVal);
              for (var userId in buddylist) {
                if (buddylist.hasOwnProperty(userId) && userId !== myID) {
                  chatClient.send(userId, makePaxosMessage("AREQ", inst, prepNum, myID, myVal));
                }
              }
            }
          }
        }
        break;
      case "NACK": 
        break;
      case "AREQ":
        break;
      case "ACPT":
        break;
      case "LRND":
        break;
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
