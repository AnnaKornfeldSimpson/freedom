/*globals console, freedom:true, exports */
/*jslint indent:2, white:true, sloppy:true, browser:true */

/**
 * Implementation of a Social provider with a fake buddylist
 * 'Other User' echos everything you send to it back to you
 * This is particularly useful when you're debugging UIs with multi-user interactions
 *
 * The provider offers
 * - a buddylist of fake users
 * - no reliability of message delivery
 * - in-order delivery
 * - clients are statically defined in the class
 * - 'Other User' is a special buddy that echos what you say back to you
 **/

function LoopbackSocialProvider(dispatchEvent) {
  this.dispatchEvent = dispatchEvent;

  //Constants
  this.time = (new Date()).getTime();
  this.userId = 0;      //My userId
  this.clientId = '0.client';  //My clientId
  this.social = freedom();

  //Populate a fake roster
  this.users = {
    0: this.makeUserEntry(this.userId),
    1: this.makeUserEntry(1),
  };
  this.clients = {};
}

// Autocreates fake rosters with variable numbers of clients
// and random statuses
LoopbackSocialProvider.prototype.makeUserEntry = function(userId) {
  return {
    userId: userId,
    name: userId,
    lastUpdated: this.time
  };
};

LoopbackSocialProvider.prototype.fillClients = function() {
  var STATUSES = ['ONLINE', 'OFFLINE', 'ONLINE_WITH_OTHER_APP'],
      userId, nClients, clientId, i;
  this.clients = {
    "0.client": {
      'userId': this.userId,
      'clientId': this.clientId,
      'status': "ONLINE",
      'lastUpdated': this.time,
      'lastSeen': this.time
    },
    "1.client": {
      'userId': 1,
      'clientId': "1.client",
      'status': "ONLINE",
      'lastUpdated': this.time,
      'lastSeen': this.time
    },
  };

  /*for (userId in this.users) {
    if (this.users.hasOwnProperty(userId)) {
      nClients = userId.charCodeAt(0) % 3;
      for (i = 0; i < nClients; i += 1) {
        clientId = userId + '/-client' + (i + 1);
        this.clients[clientId] = {
          userId: userId,
          clientId: clientId,
          status: STATUSES[i],
          lastUpdated: this.time,
          lastSeen: this.time
        };
      }
    }
  }*/
  return;
};

// Log in. Options are ignored
// Roster is only emitted to caller after log in
LoopbackSocialProvider.prototype.login = function(opts, continuation) {
  var userId, clientId;

  
  if (this.clients.hasOwnProperty(this.clientId)) {
    continuation(undefined, this.err("LOGIN_ALREADYONLINE"));
    return;
  }
  this.fillClients();
  
  
  for (userId in this.users) {
    if (this.users.hasOwnProperty(userId)) {
      this.dispatchEvent('onUserProfile', this.users[userId]);
    }
  }
  for (clientId in this.clients) {
    if (this.clients.hasOwnProperty(clientId)) {
      this.dispatchEvent('onClientState', this.clients[clientId]);
    }
  }
  console.log("login " + this.users[this.userId].userId + " " + this.clients[this.clientId].userId);
  continuation(this.clients[this.clientId]);
};

// Clear credentials (there are none)
LoopbackSocialProvider.prototype.clearCachedCredentials = function(continuation) {
  return;
};

// Return the user profiles
LoopbackSocialProvider.prototype.getUsers = function(continuation) {
  if (!this.clients.hasOwnProperty(this.clientId)) {
    continuation(undefined, this.err("OFFLINE"));
    return;
  }
  continuation(this.users);
};

// Return the clients
LoopbackSocialProvider.prototype.getClients = function(continuation) {
  if (!this.clients.hasOwnProperty(this.clientId)) {
    continuation(undefined, this.err("OFFLINE"));
    return;
  }
  continuation(this.clients);
};

// Send a message to someone.
// All messages not sent to this.userId will be echoed back to self as if
// sent by 'Other User'
LoopbackSocialProvider.prototype.sendMessage = function(to, msg, continuation) {
  if (!this.clients.hasOwnProperty(this.clientId)) {
    continuation(undefined, this.err("OFFLINE"));
    return;
  } else if (!this.clients.hasOwnProperty(to) && !this.users.hasOwnProperty(to)) {
    continuation(undefined, this.err("SEND_INVALIDDESTINATION"));
    return;
  }

  console.log("Social to: " + to + " msg " + msg);
  
  if (to === this.userId || to === this.clientId) {
    this.dispatchEvent('onMessage', {
      from: this.clients[this.clientId],
      message: msg
    });
  } else if (to === "Other User") {
    this.dispatchEvent('onMessage', {
      from: this.clients["Other User.0"],
      message: msg
    });
  }
  continuation();
};

// Log out. All users in the roster will go offline
// Options are ignored
LoopbackSocialProvider.prototype.logout = function(continuation) {
  var clientId;
  if (!this.clients.hasOwnProperty(this.clientId)) {
    continuation(undefined, this.err("OFFLINE"));
    return;
  }

  for (clientId in this.clients) {
    if (this.clients.hasOwnProperty(clientId)) {
      this.clients[clientId].status = 'OFFLINE';
      this.dispatchEvent('onClientState', this.clients[clientId]);
    }
  }

  this.clients = {};
  continuation();
};

LoopbackSocialProvider.prototype.err = function(code) {
  var err = {
    errcode: code,
    message: this.social.ERRCODE[code]
  };
  return err;
};

/** REGISTER PROVIDER **/
if (typeof freedom !== 'undefined') {
  freedom().provideAsynchronous(LoopbackSocialProvider);
}

if (typeof exports !== 'undefined') {
  exports.provider = LoopbackSocialProvider;
  exports.name = 'social';
}
