import { Collection, MongoClient } from 'mongodb';
import fetch from 'node-fetch';
import { Ip, IpAddress, IpAddressAugmented, Sizes } from './types';
import dotenv from 'dotenv';

dotenv.config();
const API_KEY = process.env.ipstackkey;

console.log('Access key = ' + API_KEY);

const ipstackUrl = 'http://api.ipstack.com/';

const uri: string = 'mongodb://root:rootpassword@localhost:27017';
const client = new MongoClient(uri);
const cache: { [key: string]: Ip } = {};
let database = null,
  collection: Collection<any> | null = null;

async function run() {
  await client.connect();

  database = client.db('geolocations');
  collection = database.collection('geolocations');
}

run();
async function fetchIpFromDb(ipAddress: string) {
  if (!collection) {
    console.error("Don't have a collection");
    return;
  }
  const query = {
    address: ipAddress,
  };

  console.log('trying to get ipaddress from db ' + ipAddress);

  const location = await collection.findOne(query);

  console.log('resutls from db for ip: ', ipAddress);
  if (location) {
    console.log('Got location of ' + ipAddress + ' from db');
    const toStore = Object.assign({}, location);
    delete toStore.geolocation._id;
    cache[ipAddress].geolocation = toStore;
  } else {
    console.log('Trying to get location of ' + ipAddress);
    const result = await fetch(ipstackUrl + ipAddress + '?access_key=' + API_KEY).then((res) => res.json());
    if (result) {
      cache[ipAddress].geolocation = {
        latitude: result.latitude,
        longitude: result.longitude,
      };
      await collection.insertOne(cache[ipAddress]);
      console.log('Got location of ' + ipAddress + ' from ipstack');
    }
  }
  return;
}

export function closeConnection() {
  client.close();
}
export function makeIp(ipAddress: string) {
  if (!cache[ipAddress]) {
    cache[ipAddress] = {
      address: ipAddress,
      geolocation: null,
    };
    fetchIpFromDb(ipAddress);
  } else {
    console.log('ip address in cache', ipAddress);
  }

  return cache[ipAddress];
}
export function makeIpAddressAugmented(ipaddress: IpAddress, isInternal: boolean): IpAddressAugmented {
  return {
    outIP: makeIp(ipaddress.outIP),
    outPort: ipaddress.outPort,
    outSize: ipaddress.outSize,
    inIp: makeIp(ipaddress.inIp),
    inPort: ipaddress.inPort,
    inSize: ipaddress.inSize,
    isInternal: isInternal,
    routes: [],
  };
}
