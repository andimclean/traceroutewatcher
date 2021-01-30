import { spawn } from 'child_process';
import readline from 'readline';
import dotenv from 'dotenv';
import amqp from 'amqplib/callback_api';
import { IpAddress, IpAddressArgumented } from './types';

const rabbitMqHost = process.env.RabbitMQHost || 'localhost';
const readFromChannelName = process.env.ipAddressChannelName || 'ipaddress';
const writeToChannelName = process.env.ipAddressChannelName || 'ipaddressArgumented';

const traceRouteArgs = [process.env.traceRouteArgs || '-n'];

const command = 'traceroute';

const isInternalIpRegEx = new RegExp(/(^127\.)|(^10\.)|(^172\.1[6-9]\.)|(^172\.2[0-9]\.)|(^172\.3[0-1]\.)|(^192\.168\.)/);

const traceRoutrregEx = new RegExp(/(\d+)\s+(\d+\.\d+.\.\d+\.\d+)\s+(\d+\.\d+).+(\d+\.\d+).*(\d+\.\d+)/);
const traceRouteNumGroups = 6;
const traceRouteIpGroup = 2;

const cache: { [key: string]: IpAddressArgumented } = {};

function makeIsInternal(message: IpAddress): string {
  return (isInternalIpRegEx.test(message.outIP) ? '0' : '1') + (isInternalIpRegEx.test(message.inIp) ? '0' : '1');
}

function traceRoute(fromIpAddress: string, toIpAddress: string, msg: IpAddressArgumented): void {
  const args = [...[...traceRouteArgs, toIpAddress]];

  const traceRoute = spawn(command, args);
  const rl = readline.createInterface({
    input: traceRoute.stdout,
  });

  traceRoute.stderr.on('data', (data) => {
    console.error('ERROR', data.toString());
  });
  rl.on('line', (line: string) => {
    const groups = traceRoutrregEx.exec(line);

    if (groups && groups.length == traceRouteNumGroups) {
      const id = makeId(fromIpAddress, toIpAddress);
      cache[id] =
        cache[id] ||
        Object.assign({}, msg, {
          outIP: fromIpAddress,
          outPort: null,
          inIp: toIpAddress,
          inPort: null,
        });
      msg.routes.push(groups[traceRouteIpGroup]);
      const origid = makeId(msg.outIP, msg.inIp);
      cache[origid] = msg;
    }
  });
}

function createItem(message: IpAddress): IpAddressArgumented | null {
  const isInternal = makeIsInternal(message);
  switch (isInternal) {
    case '00': // both internal
      return Object.assign({}, message, {
        isInternal: true,
        routes: [],
      });
    case '01': // Internal external
      const toReturn1 = Object.assign({}, message, {
        isInternal: false,
        routes: [],
      });
      traceRoute(toReturn1.outIP, toReturn1.inIp, toReturn1);
      return toReturn1;
    case '10':
      const toReturn2 = Object.assign({}, message, {
        isInternal: false,
        routes: [],
      });
      traceRoute(toReturn2.inIp, toReturn2.outIP, toReturn2);
      return toReturn2;

    case '11': // Both external;
      const toReturn3 = Object.assign({}, message, {
        isInternal: false,
        routes: [],
      });
      return toReturn3;
  }

  return null;
}

amqp.connect('amqp://' + rabbitMqHost, (error, connection) => {
  if (error) {
    throw error;
  }
  connection.createChannel((error1, channel) => {
    if (error1) {
      throw error1;
    }

    channel.assertQueue(readFromChannelName, {
      durable: false,
    });

    channel.assertQueue(writeToChannelName, {
      durable: false,
    });

    const toDelete = ['fields', 'properties', 'content'];

    channel.consume(
      readFromChannelName,
      (msg) => {
        if (msg && msg.content) {
          const message: IpAddress = JSON.parse(msg.content.toString());
          const id = makeId(message.outIP, message.inIp);
          cache[id] = cache[id] || createItem(message);

          const tosendObj = toDelete.reduce((accum: { [key: string]: any }, key: string) => {
            delete accum[key];
            return accum;
          }, Object.assign({}, cache[id], msg));

          channel.sendToQueue(writeToChannelName, Buffer.from(JSON.stringify(tosendObj)));
          channel.ack(msg);
        }
      },
      {}
    );
  });
});

function makeId(inStr: string, out: string): string {
  return [inStr, out].join('_');
}
