// Txt with Strangers
// Author - Eric Koslow

//// SETUP

// Load locally modified version of node twilio
var TwilioClient = require('./node-twilio').Client,
    Twiml = require('./node-twilio').Twiml,
    // Load config
    config = require('./config').Credentials,
    express = require('express'),
    // Set up express
    app = express.createServer(express.logger(), express.bodyParser()),
    sys = require('sys'),
    redis = require('redis');

//Set up redis for Heroku
if (process.env.REDISTOGO_URL) {
  var rtg   = require("url").parse(process.env.REDISTOGO_URL),
      db    = redis.createClient(rtg.port, rtg.hostname);
  db.auth(rtg.auth.split(":")[1]);
} else {
  var db = redis.createClient();
}

var client = new TwilioClient(config.sid, config.token, config.hostname, {express: app}),
    phoneNumber = config.phoneNumber,
    queue = [],
    timeout = 60*5,
    helpText = "Welcome to Txt with Strangers. Send 'join' to join a chat, then anytime send 'leave' to leave the chat. Have Fun!",


//// FUNCTIONS

    // Sends a txt to a number
    // param - the number to send to
    // param - the string to send
    send = function(number, text) { 
      client.sendSms(phoneNumber, number, text, null, 
      // Success
      function(text) { 
        console.log("'"+text+"' from "+phoneNumber+" to "+number);
      }, 
      // Fail
      function(err) {
        console.log("Error sending sms: " + err);
      }); 
    },

    // Returns true if this number in a current chat
    // param number - the number to check
    // callback
    //  param - boolean is the user in chat
    //  param - if in chat, the number they are chatting with
    isInChat = function(number, cb) {
      db.get(number, function(err, reply) {
        cb(!!reply, reply);
      });
    },

    // Adds a user to the chat
    // If the chat pool is empty, they will be put in a queue, else they will
    // be connected with the first person in the queue
    // param - the number to add to the chat pool
    // callback
    //   param - the text to send back to the number
    // side effect - if connect to another number, that other number is txted
    //   telling them they have been connected
    joinChat = function(number, cb) {
      if(queue.length > 0) {
        var other = queue.pop();
        console.log(other + " removed from queue");
        //Set other => number, expires => 60 secs;
        db.set(other, number, redis.print);
        db.expire(other, timeout, redis.print);
        //Set number => other, exprires => 60 secs;
        db.set(number, other, redis.print);
        db.expire(number, timeout, redis.print);
        send(other, "You have been connected, start chatting.");
        cb("You have been connected, start chatting.");
      } else {
        queue.push(number);
        cb("You have been added to the queue");
        console.log(number + " has been added to the queue");
      }
    },

    // Removes a number from the chat pool
    // param - the number to remove
    // callback 
    //   param - The text to send back to the number
    // side effect - txts the partner that they have left the chat
    leaveChat = function(number, cb) {
      db.get(number, function(err, reply) {
        db.del(number);
        db.del(reply);
        send(reply, "Your partner has left");
        cb("You have left the chat, send 'join' to join again");
      });
    },

    // Formats a string in TWIML
    // param - string to format
    smsXml = function(text) {
      return new Twiml.Response().append(new Twiml.Sms(text)).toString();
    };


// DB setup
db.on("error", function (err) {
    console.log("Error " + err);
});

var port = process.env.PORT || 3000;
db.on("connect", function() {
  console.log("Connected to Redis");
});

//// EXPRESS

app.post('/twilio', function(req, response) {
  // console.log("REQUEST:");
  // console.log(req);
  var from = req.body.From, // Phone number
      body = req.body.Body; // Sms body
  isInChat(from, function(inChat, other) {
    if(inChat) {
      if(body.match(/^leave/i)) {
        leaveChat(from, function(text) { 
          response.send(smsXml(text));
        });
      } else {
        if(other) {
          //Exprire req.From 60 secs
          db.expire(from, timeout, redis.print);
          send(other, body);
          response.send();
        // Cannot find partner in DB
        } else {
          //remove req.From
          db.del(from, redis.print);
          response.send(smsXml("I'm sorry, your partner has left"));
        }
      }
    // Not in chat
    } else {
      if(body.match(/^join/i)) {
        joinChat(from, function(text) { 
          response.send(smsXml(text));
        });
      // Send welcome txt
      } else {
        response.send(smsXml(helpText));
      }
    }
  });
});

// Fix
app.post('/autoprovision/:id', function(req, response) { response.send("", 200); });

//// START
app.listen(port);
console.log("Started express app");
