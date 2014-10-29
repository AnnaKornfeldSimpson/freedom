/*globals freedom */
/*jslint indent:2, node:true, sloppy:true, browser:true */

/**
 * Implementation of a social provider backed by a public
 * get/append log accessible via XHRs.
 *
 * @class LogSocialProvider
 * @constructor
 * @param {Function} dispatchEvent callback to signal events
 **/
function LogSocialProvider(dispatchEvent) {
  this.dispatchEvent = dispatchEvent;

  this.social = freedom();
  
  this.users = {};    // List of seen users (<user_profile>)
  this.clients = {};  // List of seen clients (<client_state>)
  
  this.url = null;
  this.id = null;     // userId of this user
  this.user = "User" + Math.floor(Math.random()*1000); /* NO SPACES IN NAMES */
  this.lastScan = 0;

}

/**
 * Connect to the log.
 * e.g. social.login(Object options)
 * The login options used are:
 * 'agent' - The destination / filter employed
 * 'url' - The log used
 *
 * @method login
 * @param {Object} loginOptions
 * @return {Object} status - Same schema as 'onStatus' events
 **/
LogSocialProvider.prototype.login = function (loginOpts, continuation) {
  // Wrap the continuation so that it will only be called once by
  // onmessage in the case of success.

  if (this.url !== null) {
    continuation(undefined, this.err("LOGIN_ALREADYONLINE"));
    return;
  }
  this.url = loginOpts.url;
  this.agent = loginOpts.agent;
  this.beginMonitoring();
  console.log("Social: logging has begun user: " + this.user + " url " + this.url);
  this.write('ONLINE', function (continuation, resp) {
    if (resp.success) {
      continuation({
        userId: this.user,
        clientId: this.user,
        status: 'ONLINE'
      });
    } else {
      continuation(undefined, {
        errcode: "LOGIN_FAILEDCONNECTION",
        message: resp.success
      });
    }
  }.bind(this, continuation));
};



/**
 * Returns all the <user_profile>s that we've seen so far (from 'onUserProfile' events)
 * Note: the user's own <user_profile> will be somewhere in this list. 
 * Use the userId returned from social.login() to extract your element
 * NOTE: This does not guarantee to be entire roster, just users we're currently aware of at the moment
 * e.g. social.getUsers();
 *
 * @method getUsers
 * @return {Object} { 
 *    'userId1': <user_profile>,
 *    'userId2': <user_profile>,
 *     ...
 * } List of <user_profile>s indexed by userId
 *   On failure, rejects with an error code (see above)
 **/
LogSocialProvider.prototype.getUsers = function (continuation) {
  if (this.url === null) {
    continuation(undefined, this.err("OFFLINE"));
    return;
  }
  continuation(this.users);
};

/**
 * Returns all the <client_state>s that we've seen so far (from any 'onClientState' event)
 * Note: this instance's own <client_state> will be somewhere in this list
 * Use the clientId returned from social.login() to extract your element
 * NOTE: This does not guarantee to be entire roster, just clients we're currently aware of at the moment
 * e.g. social.getClients()
 * 
 * @method getClients
 * @return {Object} { 
 *    'clientId1': <client_state>,
 *    'clientId2': <client_state>,
 *     ...
 * } List of <client_state>s indexed by clientId
 *   On failure, rejects with an error code (see above)
 **/
LogSocialProvider.prototype.getClients = function (continuation) {
  if (this.url === null) {
    continuation(undefined, this.err("OFFLINE"));
    return;
  }
  continuation(this.clients);
};

/** 
 * Send a message to user on your network
 * If the destination is not specified or invalid, the message is dropped
 * Note: userId and clientId are the same for this.websocket
 * e.g. sendMessage(String destination_id, String message)
 * 
 * @method sendMessage
 * @param {String} destination_id - target
 * @return nothing
 **/
LogSocialProvider.prototype.sendMessage = function (to, msg, continuation) {
  console.log("Social sending from: " + this.user + " to: " + to + " msg: " + msg);
  if (this.url === null) {
    continuation(undefined, this.err("OFFLINE"));
    return;
  } else if (!this.clients.hasOwnProperty(to) && !this.users.hasOwnProperty(to)) {
    continuation(undefined, this.err("SEND_INVALIDDESTINATION"));
    return;
  }

  //post
  this.write(JSON.stringify({to: to, msg: msg}), function () {
    continuation();
  });
};

/**
   * Disconnects from the Web Socket server
   * e.g. logout(Object options)
   * No options needed
   * 
   * @method logout
   * @return {Object} status - same schema as 'onStatus' events
   **/
LogSocialProvider.prototype.logout = function (continuation) {
  if (this.url === null) { // We may not have been logged in
    this.changeRoster(this.id, false);
    continuation(undefined, this.err("OFFLINE"));
    return;
  }
  this.url = null;
  continuation();
  this.changeRoster(this.id, false);
};

/**
 * INTERNAL METHODS
 **/

var onRead;

LogSocialProvider.prototype.beginMonitoring = function () {
  if (!this.url) {
    return;
  }

  onRead = function (resp) {
    if (resp.items) {
      var readCounter = 0;
      resp.items.forEach(function (item) {
        readCounter++;
        if (!this.users.hasOwnProperty(item.from) && !this.clients.hasOwnProperty(item.from)) {
          this.changeRoster(item.from, true);
          //console.warn(this.user);
        }
        try {
          var actualMsg = JSON.parse(item.msg);
          var actualTo = +actualMsg.to;
          //console.log("Social: reading new message to: " + actualTo + " time: " + new Date(item.time));
          if (actualTo === this.user && new Date(item.time) > this.lastScan) {
            console.log("Social: dispatching onMessage for: " + actualMsg.to + " from " + item.from + " msg " + actualMsg.msg);
            this.dispatchEvent('onMessage', {
              from: {
                userId: item.from,
                clientId: item.from,
                status: 'ONLINE',
                lastUpdated: item.time,
                lastSeen: item.time
              },
              message: actualMsg.msg
            });
          }
        } catch (e) {
          //console.log("Error parsing message: " + "'" + item.msg + "' err:" + e);
        }
        if (new Date(item.time) > this.lastScan) {
          this.lastScan = new Date(item.time);
          //console.log("Social lastScan is now: " + this.lastScan);
        }
      }.bind(this));
      console.log("onRead has read " + readCounter);
    }
    setTimeout(this.beginMonitoring.bind(this), 5000);
  }.bind(this);
  
  // TODO: use core API for jsonp.
  importScripts(this.url + "?callback=onRead&dest=" + this.agent);
};

var onWrite;

LogSocialProvider.prototype.write = function (msg, cb) {
  onWrite = cb;
  //console.log("write: " + msg);
  importScripts(this.url + "?callback=onWrite&dest=" + this.agent + "&src=" + this.user + "&msg=" + msg);
};

/**
 * Dispatch an 'onClientState' event with the following status and return the <client_card>
 * Modify entries in this.users and this.clients if necessary
 * Note, because this provider has a global buddylist of ephemeral clients, we trim all OFFLINE users
 *
 * @method changeRoster
 * @private
 * @param {String} id - userId and clientId are the same in this provider
 * @param {Boolean} stat - true if "ONLINE", false if "OFFLINE".
 *                          "ONLINE_WITH_OTHER_APP"
 * @return {Object} - same schema as 'onStatus' event
 **/
LogSocialProvider.prototype.changeRoster = function (id, stat) {
  var newStatus, result = {
    userId: id,
    clientId: id,
    lastUpdated: (this.clients.hasOwnProperty(id)) ? this.clients[id].lastUpdated : (new Date()).getTime(),
    lastSeen: (new Date()).getTime()
  };
  if (stat) {
    newStatus = "ONLINE";
  } else {
    newStatus = "OFFLINE";
  }
  result.status = newStatus;
  if (!this.clients.hasOwnProperty(id) ||
      (this.clients[id] && this.clients[id].status !== newStatus)) {
    this.dispatchEvent('onClientState', result);
  }

  if (stat) {
    this.clients[id] = result;
    if (!this.users.hasOwnProperty(id)) {
      this.users[id] = {
        userId: id,
        name: id,
        lastUpdated: (new Date()).getTime()
      };
      this.dispatchEvent('onUserProfile', this.users[id]);
    }
  } else {
    delete this.users[id];
    delete this.clients[id];
  }
  
  //console.log("changeRoster id" + id + this.users[id] + this.clients[id]);
  
  return result;
};

LogSocialProvider.prototype.err = function (code) {
  var err = {
    errcode: code,
    message: this.social.ERRCODE[code]
  };
  return err;
};

/** REGISTER PROVIDER **/
if (typeof freedom !== 'undefined') {
  freedom().provideAsynchronous(LogSocialProvider);
}

if (typeof exports !== 'undefined') {
  exports.provider = LogSocialProvider;
  exports.name = 'social';
}
