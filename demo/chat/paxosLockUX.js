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
    lockStatus = [],
    approvedQueue = [];
    
  document.getElementById('msg-input').focus();
  
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

  // Paxos learned value from somebody, from:from, value:value
  chatClient.on('recv-message', function (data) {
    console.log("Client Received " + data.value + " from " + data.from);
    var lockNum = +(data.value.substr(data.value.indexOf('(') + 1, data.value.length - 1));
    if (data.value.indexOf('(') === 4) { // it's a lock
      if (lockStatus[lockNum] === true) { 
        approvedQueue[lockNum].push();
      }
      else {
        lockStatus[lockNum] = true;
      }
    }
    else { /* unlock */
      lockStatus[lockNum] = false;
      if(approvedQueue[lockNum].length > 0) {
        approvedQueue[lockNum].shift();
        lockStatus[lockNum] = true;
      }
    }
    appendLog(document.createTextNode(data.from + ": " + data.value));
  });
  
  // On new messages, append it to our message log
  chatClient.on('recv-err', function (data) {
    document.getElementById('uid').textContent = "Error: " + data.message;
  });

  // Display our own userId when we get it
  chatClient.on('recv-uid', function (data) {
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
      if (text.indexOf('lock(') !== -1 || text.indexOf('unlock(') !== -1) {
        var numStart = text.indexOf('(') + 1;
        if (!isNaN(+text.substr(numStart, text.length - 1)) && text.indexOf(')') === text.length - 1) {
          chatClient.enqueue(text);
          appendLog(document.createTextNode("Your request was enqueued: " + text));
        }
        else {
          appendLog(document.createTextNode("Entry must be a lock(x) or unlock(x)"));
        }
      }
      else {
        appendLog(document.createTextNode("Entry must be a lock(x) or unlock(x)"));
      }
      
    }
  };
}

window.onload = function () {
  freedom('manifest.json').then(start);
};
