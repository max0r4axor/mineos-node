var fs = require('fs-extra');
var path = require('path');
var events = require('events');
var async = require('async');
var cf = require('./config_file');
var child_process = require('child_process');
var mineos = exports;

mineos.DIRS = {
  'servers': 'servers',
  'backup': 'backup',
  'archive': 'archive',
  'profiles': 'profiles',
  'import': 'import'
}

mineos.SP_DEFAULTS = {
  'server-port': 25565,
  'max-players': 20,
  'level-seed': '',
  'gamemode': 0,
  'difficulty': 1,
  'level-type': 'DEFAULT',
  'level-name': 'world',
  'max-build-height': 256,
  'generate-structures': 'false',
  'generator-settings': '',
  'server-ip': '0.0.0.0',
}

mineos.server_list = function(base_dir) {
  return fs.readdirSync(path.join(base_dir, mineos.DIRS['servers']));
}

mineos.server_list_up = function() {
  return Object.keys(mineos.server_pids_up());
}

mineos.server_pids_up = function() {
  var cmdline, environ, match;
  var pids = fs.readdirSync('/proc').filter(function(e) { if (/^([0-9]+)$/.test(e)) {return e} });
  var SCREEN_REGEX = /screen[^S]+S mc-([^ ]+)/i;
  var JAVA_REGEX = /\.mc-([^ ]+)/i;
  var servers_found = {};

  for (var i=0; i < pids.length; i++) {
    cmdline = fs.readFileSync('/proc/{0}/cmdline'.format(pids[i]))
                              .toString('ascii')
                              .replace(/\u0000/g, ' ');
    screen_match = SCREEN_REGEX.exec(cmdline);

    if (screen_match) {
      if (screen_match[1] in servers_found)
        servers_found[screen_match[1]]['screen'] = parseInt(pids[i]);
      else
        servers_found[screen_match[1]] = {'screen': parseInt(pids[i])}
    } else {
      environ = fs.readFileSync('/proc/{0}/environ'.format(pids[i]))
                                .toString('ascii')
                                .replace(/\u0000/g, ' ');
      java_match = JAVA_REGEX.exec(environ);

      if (java_match) {
        if (java_match[1] in servers_found)
          servers_found[java_match[1]]['java'] = parseInt(pids[i]);
        else
          servers_found[java_match[1]] = {'java': parseInt(pids[i])}
      }
    }
  }
  return servers_found;
}

mineos.valid_server_name = function(server_name) {
  var regex_valid_server_name = /^(?!\.)[a-zA-Z0-9_\.]+$/;
  return regex_valid_server_name.test(server_name);
}

mineos.extract_server_name = function(base_dir, server_path) {
  var re = new RegExp('{0}/([a-zA-Z0-9_\.]+)'.format(path.join(base_dir, mineos.DIRS['servers'])));
  try {
    return re.exec(server_path)[1];
  } catch(e) {
    throw new Error('no server name in path');
  }
}

mineos.mc = function(server_name, base_dir) {
  var self = this;
  self.server_name = server_name;
  self.ev = new events.EventEmitter();

  self.env = {
    base_dir: base_dir,
    cwd: path.join(base_dir, mineos.DIRS['servers'], server_name),
    bwd: path.join(base_dir, mineos.DIRS['backup'], server_name),
    awd: path.join(base_dir, mineos.DIRS['archive'], server_name),
    sp: path.join(base_dir, mineos.DIRS['servers'], server_name, 'server.properties')
  }

  self._sp = new cf.config_file(self.env.sp);

  self.is_server = function(callback) {
    fs.exists(self.env.sp, function(exists) {
      callback(null, exists);
    });
  }

  self.sp = function(callback) {
    self._sp.load(function(err) {
      callback(self._sp.props);
    })
  }

  self.create = function(callback) {
    async.each([self.env.cwd, self.env.bwd, self.env.awd], fs.mkdirs, function(err) {
      self._sp.write(mineos.SP_DEFAULTS, function(err) {
        if (!err) {
          var dest = [self.env.cwd, self.env.bwd, self.env.awd, self.env.sp];
          for (var i=0; i < dest.length; i++) {
            fs.chown(dest[i], 1000, 1001);
          }
          callback(err, true);
        }
      });
    })
  }

  self.delete = function(callback) {
    async.each([self.env.cwd, self.env.bwd, self.env.awd], fs.remove, function(err) {
      callback(err, true);
    });
  }

  self.start = function(callback) {
    var binary = '/usr/bin/screen';
    var args = ['-dmS', 'mc-{0}'.format(self.server_name), 
                '/usr/bin/java', '-server', '-Xmx256M', '-Xms256M',
                '-jar',  'minecraft_server.jar', 'nogui'];
    var params = {
        cwd: self.env.cwd,
        uid: 1000,
        gid: 1001
      }

    fs.copy('/var/games/minecraft/profiles/vanilla179/minecraft_server.1.7.9.jar',
            path.join(self.env.cwd, 'minecraft_server.jar'), function(err) {
              if (!err)
                callback(true, child_process.spawn(binary, args, params));
              else
                callback(false, null);
            });
  }

  self.kill = function(callback) {
    process.kill(mineos.server_pids_up()[self.server_name].java);
    callback(null, true);
  }

  self.stuff = function(msg, callback) {
    var params = {
      cwd: self.env.cwd,
      uid: 1000,
      gid: 1001
    }

    self.property('up', function(err, up) {
      if (up)
        callback(true, child_process.spawn('/usr/bin/screen', 
                       ['-S', 'mc-{0}'.format(self.server_name), 
                        '-p', '0', '-X', 'eval', 'stuff "{0}\012"'.format(msg)], 
                       params));
      else
        callback(false, null);
    })
  }

  self.archive = function(callback) {
    var strftime = require('strftime');
    var binary = '/bin/tar';
    var filename = 'server-{0}_{1}.tgz'.format(self.server_name, strftime('%Y-%m-%d_%H:%M:%S'));
    var args = ['czf', path.join(self.env.awd, filename), self.env.cwd];
    var params = {
      cwd: self.env.awd,
      uid: 1000,
      gid: 1001
    }

    callback(true, child_process.spawn(binary, args, params));
  }

  self.backup = function(callback) {
    var binary = '/usr/bin/rdiff-backup';
    var args = ['{0}/'.format(self.env.cwd), self.env.bwd];
    var params = {
      cwd: self.env.bwd,
      uid: 1000,
      gid: 1001
    }

    callback(true, child_process.spawn(binary, args, params));
  }

  self.restore = function(step, callback) {
    var binary = '/usr/bin/rdiff-backup';
    var args = ['--restore-as-of', step, self.env.bwd, self.env.cwd];
    var params = {
      cwd: self.env.bwd
    }

    callback(true, child_process.spawn(binary, args, params));
  }

  self.property = function(property, callback) {
    switch(property) {
      case 'up':
        var pids = mineos.server_pids_up();
        callback(null, self.server_name in pids);
        break;
      case 'java_pid':
        var pids = mineos.server_pids_up();
        callback(null, pids[self.server_name]['java']);
        break;
      case 'screen_pid':
        var pids = mineos.server_pids_up();
        callback(null, pids[self.server_name]['screen']);
        break;
      case 'server-port':
        var sp = self.sp(function(dict) {
          callback(null, dict['server-port']);
        })
        break;
      case 'server-ip':
        var sp = self.sp(function(dict) {
          callback(null, dict['server-ip']);
        })
        break;
      case 'memory':
        var pids = mineos.server_pids_up();
        if (self.server_name in pids) {
          var procfs = require('procfs-stats');
          var ps = procfs(pids[self.server_name]['java']);
          ps.status(function(err, data){
            callback(err, data);
          })
        } else {
          callback(null, {});
        }
        break;
      case 'ping':
        var pids = mineos.server_pids_up();
        if (self.server_name in pids) {
          self.ping(null, null, function(ping){
            callback(null, ping);
          })
        } else {
          callback(null, {
            protocol: null,
            server_version: null,
            motd: null,
            players_online: null,
            players_max: null
          })
        }
        break;
    }
  }

  self.ping = function(callback) {
    function swapBytes(buffer) {
      /*http://stackoverflow.com/a/7460958/1191579*/
      var l = buffer.length;
      if (l & 0x01) {
        throw new Error('Buffer length must be even');
      }
      for (var i = 0; i < l; i += 2) {
        var a = buffer[i];
        buffer[i] = buffer[i+1];
        buffer[i+1] = a;
      }
      return buffer; 
    }

    function send_query_packet(port) {
      var net = require('net');
      var socket = net.connect({port: port});
      socket.setTimeout(2500);

      socket.on('connect', function() {
        var query = '\xfe\x01',
            buf = new Buffer(2);

        buf.write(query, 0, query.length, 'binary');
        socket.write(buf);
      });

      socket.on('data', function(data) {
        socket.end();
        var split = swapBytes(data.slice(3)).toString('ucs2').split('\u0000').splice(1);
        callback({
          protocol: parseInt(parseInt(split[0])),
          server_version: split[1],
          motd: split[2],
          players_online: parseInt(split[3]),
          players_max: parseInt(split[4])
        });
      });

      socket.on('error', function(err) {
        console.error('error:', err);
      })
    }

    self.sp(function(dict) {
      send_query_packet(dict['server-port']);
    })  
  }

  return self;
}

String.prototype.format = function() {
  var s = this;
  for(var i = 0, iL = arguments.length; i<iL; i++) {
    s = s.replace(new RegExp('\\{'+i+'\\}', 'gm'), arguments[i]);
  }
  return s;
};