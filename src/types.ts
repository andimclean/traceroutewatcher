export interface Sizes {
  last2Seconds: number;
  last10Seconds: number;
  last40Seconds: number;
  cumulative: number;
}

export interface IpAddress {
  outIP: string;
  outPort: number;
  inIp: string;
  inPort: number;
  inSize: Sizes;
  outSize: Sizes;
}

export interface GeoLocationObj {
  _id?: string;
  latitude: number;
  longitude: number;
}

export type GeoLocation = GeoLocationObj | null;

export interface Ip {
  address: string;
  geolocation: GeoLocation;
}
export interface IpAddressAugmented {
  outIP: Ip;
  outPort: number;
  inIp: Ip;
  inPort: number;
  inSize: Sizes;
  outSize: Sizes;
  isInternal: boolean;
  routes: Ip[];
}
