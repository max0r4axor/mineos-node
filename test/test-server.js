var path = require('path');
var fs = require('fs');
var async = require('async');
var mineos = require('../mineos');
var server = require('../server');
var test = exports;
var BASE_DIR = '/var/games/minecraft';

test.extract_server_name = function(test) {
  test.equal(server.extract_server_name(BASE_DIR, '/var/games/minecraft/servers/a'), 'a');
  test.equal(server.extract_server_name(BASE_DIR, '/var/games/minecraft/servers/a/b'), 'a');
  test.equal(server.extract_server_name(BASE_DIR, '/var/games/minecraft/servers/a/b/plugins'), 'a');
  test.throws(function(){server.extract_server_name(BASE_DIR, '/var/games/minecraft/servers')}, 'no server name in path');
  test.throws(function(){server.extract_server_name(BASE_DIR, '/var/games/minecraft')}, 'no server name in path');
  test.done();
}

test.start_backend = function(test) {
  var events = require('events');
  var be = server.backend(BASE_DIR);

  test.ok(be.servers instanceof Object);
  test.ok(be.front_end instanceof events.EventEmitter);

  var throwaway = new mineos.mc('testing', BASE_DIR);

  async.series([
    function(callback) {
      throwaway.create(function(did_create) {
        if (did_create) {
          setTimeout(function(){
            callback(null);
          }, 200)
        }
      })
    },
    function(callback) {
      throwaway.delete(function(did_delete) {
        if (did_delete)
          callback(null);
      })
    }
  ], function(err, results) {
    be.watcher_server_list.close();
    test.done()
  })


}