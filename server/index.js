#!/usr/bin/env node

// Dependencies
var express = require('express');
var bodyParser = require('body-parser')
var mongodb = require('mongodb');
var nconf = require('nconf');
var cors = require('cors');
var path = require('path');
var EJSON = require('mongodb-extended-json');

// Configuration
var configPath = path.resolve(__dirname, '../default_config.json');
nconf.argv()
       .env()
       .file({ file: configPath });

// Create your server
var app = express();
// Configure Express
app.use(bodyParser.json())

// CORS
if (nconf.get('server:CORS')) {
    console.log("CORS enabled.");
    app.use(cors());
}
else {
    console.log("CORS disabled.");
}

// Config Express server
if (nconf.get('server:logger')) {
    console.log("Express Logger enabled.");
    app.use(express.logger());
} else {
    console.log("Express Logger disabled.");
}


// Connect to MongoDB
var MongoClient = mongodb.MongoClient;

MongoClient.connect("mongodb://"+nconf.get('mongo:host')+":"+nconf.get('mongo:port')+"/"+nconf.get('mongo:database'), function(err, db) {

    if (err) {
        console.error(err);
        process.exit();
        return;
    }

    console.log('Connected to MongoDB at '+
        nconf.get('mongo:host')+":"+
        nconf.get('mongo:port')+" with database '"+
        nconf.get('mongo:database')+"'.");

    // Add static files, if available.
    app.use(express.static(path.resolve(__dirname,'../public')));
    app.use(express.static(path.resolve(__dirname,'../bower_components')));

    // Create REST API
    var queryToJson = function(query) {
        //console.log("query: ", query);
        var j = {};
        for (var k in query) {
            var temp = query[k];
            //console.log(k, temp);
            var v = null;
            if (typeof temp === "object") {
                v = temp;
            } else {
                try {
                    v = JSON.parse(temp);
                } catch (err) {
                    //console.log(temp+" failed to parse");
                    //console.error(err);
                    v = query[k];
                }
            }
            j[k] = v;
        }
        return j;
    };

    var basic = function(callback) {
        return function(req, res) {
            var query = queryToJson(req.query);
            // Check if Body is available and has options
            var body = req.body;
            // console.log(query, body, req.query);
            if (Object.keys(body).length > 0) {
                query = body;
            }
            db.collection(req.params.collection, function(err, collection) {
                if (err) {
                    return res.json({'error': err.toString() });
                }
                else {
                    var respCallback = function(json) {
                        // Convert JSON object to MongoDB-Extended JSON
                        var e = EJSON.stringify(json);
                        var j = JSON.parse(e);
                        return res.json(j);
                    };
                    //console.log(JSON.stringify(query));
                    // Convert query to MongoDB Extended JSON
                    var j = JSON.stringify(query);
                    var q = EJSON.parse(j);
                    // console.log(j,q);
                    return callback && callback(collection, q, respCallback);
                }
            });
        }
    };

    // Find Queries
    var find = basic(function(collection, query, callback) {
        var q = query.query || {};
        var options = query.options || {};
        collection.find(q, options).toArray(function(err, docs) {
            return callback(docs);
        });
    });
    app.get('/api/v1/:collection/find', find);

    // FindOne Queries
    var findOne = basic(function(collection, query, callback) {
        var q = query.query || {};
        var options = query.options || {};
        collection.findOne(q, options, function(err, doc) {
            return callback(doc);
        });
    });
    app.get('/api/v1/:collection/findOne', findOne);

    // Aggregation Queries
    var aggregation = basic(function(collection, query, callback) {
        // console.log(JSON.stringify(query));
        var pipeline = query.pipeline || [];
        var options = query.options || {};
        collection.aggregate(pipeline, options, function(err, docs) {
            return callback(docs);
        });
    });
    app.get('/api/v1/:collection/aggregate', aggregation);

    // Aggregation Queries
    var aggregation = basic(function(collection, query, callback) {
        var pipeline = query.pipeline || [];
        var options = query.options || {};
        collection.aggregate(pipeline, options, function(err, docs) {
            return callback(docs);
        });
    });

    // New Data value
    var createData = function(collection, query, callback) {
        var source = query.source;
        var type = query.type;
        var date = new Date(query.date);
        var value = query.value;

        // Check for all of the required params
        if (!source) {
            return callback({'err': 'Missing required param: source'});
        }
        if (!type) {
            return callback({'err': 'Missing required param: type'});
        }
        if (!date) {
            return callback({'err': 'Missing required param: date'});
        }
        if (!value) {
            return callback({'err': 'Missing required param: value'});
        }

        // Remember the position in the hour
        var second = date.getUTCSeconds();
        var minute = date.getUTCMinutes();
        var milliseconds = date.getUTCMilliseconds();
        // Only show hours (no minutes / seconds / milliseconds)
        date.setUTCMinutes(0);
        date.setUTCSeconds(0);
        date.setUTCMilliseconds(0);
        // Create _id
        var _id = {
            source: source,
            type: type,
            date: date
        };

        function update(id, value, updateCallback) {
            var findQuery = { _id: _id };
            var updateQuery = { $setOnInsert: {}, $set: {}, $inc: {} };
            // Add data point - $set
            updateQuery.$set['values.'+minute+'.'+second] = value;
            // Add to aggregation - $inc
            updateQuery.$inc['values.count'] = 1;
            updateQuery.$inc['values.total'] = value;
            updateQuery.$inc['values.'+minute+'.count'] = 1;
            updateQuery.$inc['values.'+minute+'.total'] = value;

            // Run Update query
            var doc = updateQuery.$setOnInsert;
            // doc.values = {
            //     'count': 0,
            //     'total': 0
            // };
            var defaultValue = null; // 0.0;
            // Create space for minutes
            for (var m=0;m<=59;m++) {
                // doc.values[m] = {};
                if (m != minute) {
                    doc["values."+m+".count"] = 0;
                    doc["values."+m+".total"] = 0;
                }
                // Create space for seconds
                for (var s=0;s<=59;s++) {
                    if (!(m === minute && s === second)) {
                        doc["values."+m+"."+s] = defaultValue;
                    }
                }
            }

            // Options
            var options = {upsert: true};
            // console.log(JSON.stringify(updateQuery, null, 4));
            // Run Update query
            collection.update(findQuery, updateQuery, options, function(err, docs) {
                return updateCallback(err, docs);
            });

        }

        update(_id, value, function(err, docs) {
            console.log('update1', err, docs);
            return callback({
                'err': err,
                'docs': docs
            });
        });
    };
    var createDataEndpoint = basic(createData);
    app.post('/api/v1/:collection/data', createDataEndpoint);

    // Test multi-sensor writes
    var sensorCount = 100;
    var history = {};
    var collectionName = "testData";
    db.collection(collectionName, function(err, collection) {
        if (err) {
            console.log({'error': err.toString() });
        }
        setInterval(function() {
            console.log(new Date() + " - Creating "+sensorCount+" fake sensors data in collection '"+collectionName+"'.");
            var currDate = new Date();
            var source = "plant";

            for (var x=0; x<sensorCount; x++) {

              // Get history
              var h = history[x] || {};
              var prevValue = h.prev || 0;
              var i = h.i || 0;
              var value = Math.max(-10, Math.min(10, prevValue + .8 * Math.random() - .4 + .2 * Math.cos(i += x * .02)));
              // Store previous value
              h.prev = value;
              history[x] = h;
              // Create document
              var type = "sensor "+x;
              var query = {
                          source: source,
                          type: type,
                          date: currDate,
                          value: value
                      };
              // Insert
              // console.log(query);
              createData(collection, query, function(result) {
                // console.log(result);
              });
            }

        }, 1000);
    });

    // Start server
    console.log('Starting server on port '+nconf.get('server:port'));
    app.listen(nconf.get('server:port'), function() {
        console.info('Server listening on port '+nconf.get('server:port')+'.');
    });

});
