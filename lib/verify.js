/*
Copyright (c) 2014, Yahoo! Inc. All rights reserved.
Code licensed under the BSD License.
See LICENSE file.
*/
var http = require('http-https'),
    options = require('./args'),
    hooks = require('./hooks'),
    crypto = require('crypto'),
    timethat = require('timethat').calc,
    url = require('url'),
    uparse = url.parse,
    log = require('./logger'),
    pretty = require('prettysize');

var counter = {};

exports.counter = function verifyCounter() {
    return counter;
};

function update(info, callback) {
    var url = options.registry + info.path.substring(1);
    var callbackDone = false;
    setImmediate(function() {
        var writer = options.blobstore.createWriteStream(info.tarball);
        counter[info.path] = counter[info.path] || 0;
        counter[info.path]++;
        log.info('[' + counter[info.path] + '] downloading', url);
        var startDL = new Date();
        var u = uparse(url);
        u.headers = {
            'user-agent': 'registry static mirror worker'
        };
        var req = http.get(u)
        .on('error', function(e) {
            callbackDone = true;
            req.end();
            log.err(' [' + counter[info.path] + '] failed to download', info.tarball);
            delete counter[info.path];
            //in case end has already been called by the error handler
            //sometimes it happens :(
            try {
                writer.end();
            } catch (er) {}
            return callback(new Error('failed to download ' + info.tarball));
        })
        .on('response', function(res) {
            log.info('[' + counter[info.path] + ']', '(' + res.statusCode + ')', info.path, 'is', pretty(res.headers['content-length']));
            info.http = res.statusCode;
            if (res.statusCode === 404) {
                log.err(' [' + counter[info.path] + '] failed to download with a 404', info.tarball);
                callbackDone = true;
                delete counter[info.path];
                writer.end();
                req.abort();
                return callback(new Error('failed to download ' + info.tarball));
            }
            res.on('end', function() {
                if (callbackDone) {
                    return;
                }
                log.info('[' + counter[info.path] + '] finished downloading', url, 'in', timethat(startDL));
                exports.verify(info, callback);
            })
            .pipe(writer);
        });
    });
}

exports.update = update;

function verify (info, callback) {
    counter[info.path] = counter[info.path] || 0;
    setImmediate(function() {
        options.blobstore.exists(info.tarball, function(err, good) {
            if (!good) {
                return exports.update(info, callback);
            }
            if (counter[info.path] >= 4) {
                log.err(' [' + counter[info.path] + '] file appears to be corrupt, skipping..', info.tarball);
                delete counter[info.path];
                //bail, the tarball is corrupt
                return callback(null, info);
            }
            log.info('[' + counter[info.path] + '] checking shasum of', info.tarball);
            setImmediate(function() {
                hooks.shasumCheck(info, function(){
                    // shasum failed
                    exports.update(info, callback);
                }, function(){
                    // shasum passed
                    delete counter[info.path];
                    callback(null, info);
                });
            });
        });
    });
}

exports.verify = verify;
