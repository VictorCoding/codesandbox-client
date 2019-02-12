import React from 'react';
import { render } from 'react-dom';
import { ThemeProvider } from 'styled-components';
import { Router } from 'react-router-dom';
import { ApolloProvider } from 'react-apollo';
import { Provider } from 'mobx-react';

import history from 'app/utils/history';
import _debug from 'common/utils/debug';
import { client } from 'app/graphql/client';
import VERSION from 'common/version';
import registerServiceWorker from 'common/registerServiceWorker';
import requirePolyfills from 'common/load-dynamic-polyfills';
import 'normalize.css';
import 'common/global.css';
import theme from 'common/theme';

import * as child_process from 'node-services/lib/child_process';

import controller from './controller';
import App from './pages/index';
import './split-pane.css';
import logError from './utils/error';
import { getTypeFetcher } from './vscode/extensionHostWorker/common/type-downloader';

import vscode from './vscode';

// import extensionsBuffer from 'buffer-loader!vscode/extensions-bundle/extensions/extensions.zip';

const debug = _debug('cs:app');

window.setImmediate = (func, delay) => setTimeout(func, delay);

window.addEventListener('unhandledrejection', e => {
  if (e && e.reason && e.reason.name === 'Canceled') {
    // This is an error from vscode that vscode uses to cancel some actions
    // We don't want to show this to the user
    e.preventDefault();
  }
});

if (process.env.NODE_ENV === 'production') {
  try {
    Raven.config('https://3943f94c73b44cf5bb2302a72d52e7b8@sentry.io/155188', {
      release: VERSION,
      ignoreErrors: [
        // Random plugins/extensions
        'top.GLOBALS',
        // See: http://blog.errorception.com/2012/03/tale-of-unfindable-js-error. html
        'originalCreateNotification',
        'canvas.contentDocument',
        'MyApp_RemoveAllHighlights',
        'http://tt.epicplay.com',
        "Can't find variable: ZiteReader",
        'jigsaw is not defined',
        'ComboSearch is not defined',
        'http://loading.retry.widdit.com/',
        'atomicFindClose',
        // Facebook borked
        'fb_xd_fragment',
        // ISP "optimizing" proxy - `Cache-Control: no-transform` seems to
        // reduce this. (thanks @acdha)
        // See http://stackoverflow.com/questions/4113268
        'bmi_SafeAddOnload',
        'EBCallBackMessageReceived',
        // See http://toolbar.conduit.com/Developer/HtmlAndGadget/Methods/JSInjection.aspx
        'conduitPage',
      ],
      ignoreUrls: [
        // Facebook flakiness
        /graph\.facebook\.com/i,
        // Facebook blocked
        /connect\.facebook\.net\/en_US\/all\.js/i,
        // Woopra flakiness
        /eatdifferent\.com\.woopra-ns\.com/i,
        /static\.woopra\.com\/js\/woopra\.js/i,
        // Chrome extensions
        /extensions\//i,
        /^chrome:\/\//i,
        // Other plugins
        /127\.0\.0\.1:4001\/isrunning/i, // Cacaoweb
        /webappstoolbarba\.texthelp\.com\//i,
        /metrics\.itunes\.apple\.com\.edgesuite\.net\//i,
        // Monaco debuggers
        'https://codesandbox.io/public/13/vs/language/typescript/lib/typescriptServices.js',
      ],
    }).install();
  } catch (error) {
    console.error(error);
  }
}

window.__isTouch = !matchMedia('(pointer:fine)').matches;

function boot() {
  requirePolyfills().then(() => {
    if (process.env.NODE_ENV === 'development') {
      window.controller = controller;
    }

    const rootEl = document.getElementById('root');

    const showNotification = (message, type) =>
      controller.getSignal('notificationAdded')({
        type,
        message,
      });

    window.showNotification = showNotification;

    registerServiceWorker('/service-worker.js', {
      onUpdated: () => {
        debug('Updated SW');
        controller.getSignal('setUpdateStatus')({ status: 'available' });
      },
      onInstalled: () => {
        debug('Installed SW');
        showNotification(
          'CodeSandbox has been installed, it now works offline!',
          'success'
        );
      },
    });

    try {
      render(
        <Provider {...controller.provide()}>
          <ApolloProvider client={client}>
            <ThemeProvider theme={theme}>
              <Router history={history}>
                <App />
              </Router>
            </ThemeProvider>
          </ApolloProvider>
        </Provider>,
        rootEl
      );
    } catch (e) {
      logError(e);
    }
  });
}

// Configures BrowserFS to use the LocalStorage file system.
window.BrowserFS.configure(
  {
    fs: 'MountableFileSystem',
    options: {
      '/': { fs: 'InMemory', options: {} },
      '/sandbox': {
        fs: 'CodeSandboxEditorFS',
        options: {
          api: {
            getState: () => ({
              modulesByPath: controller.getState().editor.modulesByPath,
            }),
          },
        },
      },
      '/sandbox/node_modules': {
        fs: 'CodeSandboxFS',
        options: getTypeFetcher().options,
      },
      '/vscode': {
        fs: 'LocalStorage',
      },
      '/home': {
        fs: 'LocalStorage',
      },
      '/extensions': {
        fs: 'HTTPRequest',
        options: {
          index: '/vscode/extensions-bundle/extensions/index.json',
          baseUrl: '/vscode/extensions-bundle/extensions',
        },
      },
      // '/extensions': {
      //   fs: 'ZipFS',
      //   options: {
      //     zipData: extensionsBuffer,
      //   },
      // },
    },
  },
  e => {
    if (e) {
      console.error('Problems initializing FS', e);
      // An error happened!
      throw e;
    }

    const isVSCode =
      localStorage.getItem('settings.experimentVSCode') === 'true';

    // eslint-disable-next-line global-require
    vscode.loadScript(
      ['vs/editor/editor.main', 'vs/editor/codesandbox.editor.main'],
      () => {
        if (process.env.NODE_ENV === 'development') {
          console.log('Loaded Monaco'); // eslint-disable-line
        }
        if (isVSCode) {
          vscode.setController(controller);

          import('worker-loader?publicPath=/&name=ext-host-worker.[hash:8].worker.js!./vscode/extensionHostWorker/bootstrappers/ext-host').then(
            ExtHostWorkerLoader => {
              child_process.addDefaultForkHandler(ExtHostWorkerLoader.default);
              // child_process.preloadWorker('/vs/bootstrap-fork');
            }
          );

          import('worker-loader?publicPath=/&name=ext-host-worker.[hash:8].worker.js!./vscode/extensionHostWorker/services/searchService').then(
            SearchServiceWorker => {
              child_process.addForkHandler(
                'csb:search-service',
                SearchServiceWorker.default
              );
            }
          );
        }
        boot();
      }
    );
  }
);
