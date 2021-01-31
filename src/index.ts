import { spawn } from 'child_process';
import readline from 'readline';
import dotenv from 'dotenv';
import amqp from 'amqplib/callback_api';
import { IpAddress, IpAddressAugmented } from './types';
import { closeConnection, makeIp, makeIpAddressAugmented } from './ip-address-augmented';

dotenv.config();
const rabbitMqHost = process.env.RabbitMQHost || 'localhost';
const readFromChannelName = process.env.ipAddressChannelName || 'ipaddress';
const writeToChannelName = process.env.ipAddressChannelName || 'ipaddressArgumented';

const traceRouteArgs = [process.env.traceRouteArgs || '-n'];

const command = 'traceroute';

const isInternalIpRegEx = new RegExp(/(^127\.)|(^10\.)|(^172\.1[6-9]\.)|(^172\.2[0-9]\.)|(^172\.3[0-1]\.)|(^192\.168\.)/);

const traceRoutrregEx = new RegExp(/(\d+)\s+(\d+\.\d+.\.\d+\.\d+)\s+(\d+\.\d+).+(\d+\.\d+).*(\d+\.\d+)/);
const traceRouteNumGroups = 6;
const traceRouteIpGroup = 2;

const cache: { [key: string]: IpAddressAugmented } = {};

function makeIsInternal(message: IpAddress): string {
  return (isInternalIpRegEx.test(message.outIP) ? '0' : '1') + (isInternalIpRegEx.test(message.inIp) ? '0' : '1');
}

function traceRoute(fromIpAddress: string, toIpAddress: string, msg: IpAddressAugmented): void {
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
      msg.routes.push(makeIp(groups[traceRouteIpGroup]));
      const origid = makeId(msg.outIP.address, msg.inIp.address);
      cache[origid] = msg;
    }
  });
}

function createItem(message: IpAddress): IpAddressAugmented | null {
  const isInternal = makeIsInternal(message);
  switch (isInternal) {
    case '00': // both internal
      const toReturn0 = makeIpAddressAugmented(message, true);
      return toReturn0;
    case '01': // Internal external
      const toReturn1 = makeIpAddressAugmented(message, false);
      traceRoute(toReturn1.outIP.address, toReturn1.inIp.address, toReturn1);
      return toReturn1;
    case '10':
      const toReturn2 = makeIpAddressAugmented(message, false);
      traceRoute(toReturn2.inIp.address, toReturn2.outIP.address, toReturn2);
      return toReturn2;

    case '11': // Both external;
      const toReturn3 = makeIpAddressAugmented(message, false);
      return toReturn3;
  }

  return null;
}

try {
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
} finally {
  closeConnection();
}
function makeId(inStr: string, out: string): string {
  return [inStr, out].join('_');
}
