import {merge} from "rxjs";
import {promisify} from "util";
import {writeFile} from "fs";
import {
  directProc,
  LifecyclePort,
  mapProc,
  mapToProc,
  sink,
  source,
  stateKit,
  StatePort,
  Portcuit,
  latestMergeMapProc, Patch, Socket, EncodedPatch, encodePatch, decodePatch
} from 'pkit'
import {HttpServerContext} from "pkit/http/server";
import {FC} from "@pkit/snabbdom";
import {httpServerRestKit, HttpServerRestPort} from "pkit/http/server/index";
import {snabbdomSsrKit, SnabbdomSsrPort} from "@pkit/snabbdom/ssr";

class RendererPort<T> extends LifecyclePort<FC<T>> {}

export interface RenderPort<T> {
  renderer: RendererPort<T>;
  state: StatePort<T>;
  vdom: SnabbdomSsrPort;
}

type SharedSsrParams<T> = {
  ctx: HttpServerContext;
  Html: FC<T>;
}

export class SharedSsrPort<T> extends LifecyclePort<SharedSsrParams<T>> implements RenderPort<T> {
  rest = new HttpServerRestPort;
  state = new StatePort<T>();
  renderer = new RendererPort<T>();
  vdom = new SnabbdomSsrPort;
  patch = new class {
    encode = new Socket<Patch<T>>();
    decode = new Socket<EncodedPatch>();
  }
}

export const sharedSsrKit = <T>(port: SharedSsrPort<T>) =>
  merge(
    httpServerRestKit(port.rest),
    stateKit(port.state),
    snabbdomSsrKit(port.vdom),
    mapProc(source(port.init), sink(port.rest.init), ({ctx}) => ctx),
    mapToProc(source(port.init), sink(port.vdom.init)),
    mapProc(source(port.init), sink(port.renderer.init), ({Html}) => Html),
    directProc(source(port.vdom.html), sink(port.rest.response.html)),
    mapProc(source(port.patch.encode), sink(port.rest.response.json), encodePatch),
    mapProc(source(port.patch.decode), sink(port.state.patch), decodePatch),
    mapToProc(source(port.rest.terminated), sink(port.terminated)),
    mapToProc(source(port.init), sink(port.ready))
  )

export type CreateSsr<T> = (ctx: HttpServerContext) => Portcuit<SharedSsrPort<T>>

export type SsgInfo = [fileName: string, input: string, output: string];

type SsgParams<T> = {
  info: SsgInfo,
  Html: FC<T>
}

export class SharedSsgPort<T> extends LifecyclePort<SsgParams<T>> implements RenderPort<T> {
  state = new StatePort<T>();
  renderer = new RendererPort<T>();
  vdom = new SnabbdomSsrPort;
}

export const sharedSsgKit = <T>(port: SharedSsgPort<T>) =>
  merge(
    stateKit(port.state),
    snabbdomSsrKit(port.vdom),
    mapToProc(source(port.init), sink(port.vdom.init)),
    mapProc(source(port.init), sink(port.renderer.init), ({Html}) => Html),
  )

export type CreateSsg<T> = (...ssgInfo: SsgInfo) => Portcuit<SharedSsgPort<T>>

export const ssgPublishKit = <T>(port: SharedSsgPort<T>) =>
  latestMergeMapProc(source(port.vdom.html), sink(port.terminated),
    [source(port.init)], async ([html,{info: [fileName, input, output]}]) => {
      const path = `${output}${fileName.substr(input.length).replace(/\/ui/, '')}.html`;
      return {writeFile: await promisify(writeFile)(path, html), path}
    })