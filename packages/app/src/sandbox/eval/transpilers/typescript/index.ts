// @ts-ignore
import TypeScriptWorker from 'worker-loader?publicPath=/&name=typescript-transpiler.[hash:8].worker.js!./typescript-worker.js';

import WorkerTranspiler from '../worker-transpiler';
import { LoaderContext } from '../../transpiled-module';
import { TranspilerResult } from '..';

class TypeScriptTranspiler extends WorkerTranspiler {
  worker: Worker;

  constructor() {
    super('ts-loader', TypeScriptWorker, 3);
  }

  doTranspilation(
    code: string,
    loaderContext: LoaderContext
  ): Promise<TranspilerResult> {
    return new Promise((resolve, reject) => {
      const path = loaderContext.path;

      let foundConfig = null;
      if (
        loaderContext.options.configurations &&
        loaderContext.options.configurations.typescript &&
        loaderContext.options.configurations.typescript.parsed
      ) {
        foundConfig = loaderContext.options.configurations.typescript.parsed;
      }

      this.queueTask(
        {
          code,
          path,
          config: foundConfig,
        },
        loaderContext._module.getId(),
        loaderContext,
        (err, data) => {
          if (err) {
            loaderContext.emitError(err);

            return reject(err);
          }

          return resolve(data);
        }
      );
    });
  }
}

const transpiler = new TypeScriptTranspiler();

export { TypeScriptTranspiler };

export default transpiler;
