#!/usr/bin/env node
/**
 * Generate notifications for host or services via nagios
 * and output raw email data suitable for passing to
 * something like `mailx -t`
 *
 * Author: Dave Eddy <dave@daveeddy.com>
 * Date: 2/3/2014
 * Licens: MIT
 */

var fs = require('fs');
var path = require('path');
var util = require('util');

var ejs = require('ejs');
var getopt = require('posix-getopt');

var package = require('./package');

function usage() {
  return [
    'Usage: nagios-html-email [options] <service|host> [arg1] [arg2] ...',
    '',
    'This command is meant to be run from nagios when a service or host',
    'experiences problems.  The output will be suitable for passing to',
    'a mail program that takes raw email data like `mailx -t`',
    '',
    'Options',
    '  -a, --address <email>      the email address to send mail to, defaults to env NAGIOS_CONTACTEMAIL',
    '  -h, --help                 print this message and exit',
    '  -s, --subject <subject>    the email subject to use, defaults to _subject for the host/service, or default nagios subject',
    '  -t, --template-dir <dir>   dir to find ejs template files, defaults to builtin templates',
    '  -u, --updates              check for available updates on npm',
    '  -v, --version              print the version number and exit',
  ].join('\n');
}

// command line arguments
var options = [
  'a:(address)',
  'h(help)',
  's:(subject)',
  't:(template-dir)',
  'u(updates)',
  'v(version)'
].join('');
var parser = new getopt.BasicParser(options, process.argv);

var opts = {
  subject: null,
  templatedir: path.join(__dirname, 'templates'),
  to: process.env.NAGIOS_CONTACTEMAIL
};
var option;
while ((option = parser.getopt()) !== undefined) {
  switch (option.option) {
    case 'a': opts.to = option.optarg; break;
    case 'h': console.log(usage()); process.exit(0);
    case 's': opts.subject = option.optarg; break;
    case 't': opts.templatedir = option.optarg; break;
    case 'u': // check for updates
      require('latest').checkupdate(package, function(ret, msg) {
        console.log(msg);
        process.exit(ret);
      });
      return;
    case 'v': console.log(package.version); process.exit(0);
    default: console.error(usage()); process.exit(1);
  }
}
var args = process.argv.slice(parser.optind());

// the notification type, typically 'host' or 'subject'
var type = args.shift();
if (!type) {
  console.error('a type must be specified as the first argument!');
  console.error();
  console.error(usage());
  process.exit(1);
}

// the email address to whom the notification should be sent
if (!opts.to) {
  console.error('env NAGIOS_CONTACTEMAIL or `-e` must be supplied!');
  console.error();
  console.error(usage());
  process.exit(1);
}

// extract nagios environmental variables
var nagios = {};
Object.keys(process.env).forEach(function(key) {
  if (key.indexOf('NAGIOS_') === 0)
    nagios[key.replace(/^NAGIOS_/, '')] = process.env[key];
});
var data = {
  args: args,
  nagios: nagios
};

// create the subject if `-s` is not supplied
if (!opts.subject) {
  // look for _subject on the host or service and prefer that if it exists
  var key = util.format('_%sSUBJECT', type.toUpperCase());
  opts.subject = data.nagios[key];
  if (!opts.subject) {
    switch (type) {
      case 'host':
        opts.subject = util.format('%s is %s',
            data.nagios.HOSTALIAS,
            data.nagios.HOSTSTATE);
        break;
      case 'service':
        opts.subject = util.format('%s - %s %s',
            data.nagios.SERVICESTATE,
            data.nagios.HOSTALIAS,
            data.nagios.SERVICEDESC);
        break;
      default:
        opts.subject = util.format('unknown type - %s',
            type);
        break;
    }
  }
}

// email headers
console.log('To: %s', opts.to);
console.log('Reply-To: %s', opts.to);
console.log('Subject: %s', opts.subject);
console.log('Content-Type: text/html');
console.log();

var message;
// the message to be sent if something goes wrong
// or if a template cannot be found.
// it is just the JSON provided by the nagios daemon
var templ = '<html><body><pre><%= d %></pre></body></html>';
data.d = JSON.stringify(data, null, 2);
try {
  message = ejs.render(templ, data);
} catch(e) {
  message = util.format('error rendering default template!: %s', e.message);
  console.error(message);
}

// try to find a template, <templdr>/<type>.html.ejs
// and render it
var templfile = path.join(opts.templatedir, type + '.html.ejs');
try {
  var templ = fs.readFileSync(templfile, 'utf-8');
  message = ejs.render(templ, data);
} catch (e) {
  // if we are here, message will still be set from the above line
  // so don't overwrite it
  console.error('template %s error: %s', templfile, e.message);
}

// dump the message to stdout
console.log(message);
