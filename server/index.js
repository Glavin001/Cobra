#!/usr/bin/env node

// Dependencies
var express = require('express');
var bodyParser = require('body-parser')
var mongodb = require('mongodb');
var nconf = require('nconf');
var cors = require('cors');
var path = require('path');

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
    app.use(express.static(__dirname+'/public'));
    app.use(express.static(__dirname+'/bower_components'));

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
            if (Object.keys(body).length > 0) {
                query = body;
            }
            db.collection(req.params.collection, function(err, collection) {
                if (err) {
                    return res.json({'error': err.toString() });
                }
                else {
                    var respCallback = function(json) {
                        return res.json(json);
                    };
                    //console.log(JSON.stringify(query));
                    return callback && callback(collection, query, respCallback);
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
    var createData = basic(function(collection, query, callback) {
        var source = query.source;
        var type = query.type;
        var date = new Date(query.date);
        var value = query.value;

        // Check for all of the required params
        if (!(source && type && date && value)) {
            return callback({'err': 'Missing required param.'});
        }

        // Remember the position in the hour
        var second = date.getUTCSeconds();
        var minute = date.getUTCMinutes();
        var milliseconds = date.getUTCMilliseconds();
        // Only show hours (no minutes / seconds / milliseconds)
        date.setMinutes(0);
        date.setSeconds(0);
        date.setMilliseconds(0);
        // Create _id
        var _id = {
            source: source,
            type: type,
            date: date
        };

        function update(id, value, updateCallback) {
            var findQuery = { _id: _id };
            var updateQuery = { $set: {}, $inc: {} };
            // Add data point - $set
            updateQuery.$set['values.'+minute+'.'+second] = value;
            // Add to aggregation - $inc
            updateQuery.$inc['values.count'] = 0;
            updateQuery.$inc['values.total'] = value;
            updateQuery.$inc['values.'+minute+'.count'] = 0;
            updateQuery.$inc['values.'+minute+'.total'] = value;
            // Options
            var options = {};
            // Run Update query
            collection.update(findQuery, updateQuery, options, function(err, docs) {
                return updateCallback(err, docs);
            });
        }

        function create(id, createCallback) {
            // Run Update query
            var doc = {
                _id: id
            };
            doc.values = {
                'count': 0,
                'total': 0
            };
            var defaultValue = null; // 0.0;
            // Create space for minutes
            for (var m=0;m<=59;m++) {
                doc.values[m] = {
                    'count': 0,
                    'total': 0
                };
                // Create space for seconds
                for (var s=0;s<=59;s++) {
                    doc.values[m][s] = defaultValue;
                }
            }
            var options = {};
            collection.insert(doc, options, function(err, docs) {
                return createCallback(err, docs);
            });
        }

        update(_id, value, function(err, docs) {
            console.log('update1', err, docs);
            // Check if successful
            if (docs > 0) {
                // Successful
                return callback({
                    'err': err,
                    'docs': docs
                });
            } else {
                // Did not find doc to update
                // Must create the initial doc
                create(_id, function(err, result) {
                    console.log('create', err, result);
                    // Retry update
                    update(_id, value, function(err, docs) {
                        console.log('update2', err, docs);
                        return callback({
                            'err': err,
                            'docs': docs
                        });
                    });
                });
            }
        });
    });
    app.post('/api/v1/:collection/data', createData);

    // Start server
    console.log('Starting server on port '+nconf.get('server:port'));
    app.listen(nconf.get('server:port'), function() {
        console.info('Server listening on port '+nconf.get('server:port')+'.');
    });

});
