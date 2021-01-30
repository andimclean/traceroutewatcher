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

export interface IpAddressArgumented extends IpAddress {
  isInternal: boolean;
  routes: string[];
}
