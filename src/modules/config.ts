import * as vscode from 'vscode';
import * as memoize from 'fast-memoize';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as glob from 'glob';
import rpath, { normalize } from './remotePath';
import * as output from './output';
import Trie from '../model/Trie';
import { WORKSPACE_TRIE_TOKEN } from '../constants';

let configTrie = null;

function getPathRelativeWorkspace(filePath) {
  const normalizedWorkspacePath = normalize(vscode.workspace.rootPath);
  const normalizePath = normalize(filePath);
  if (normalizePath === normalizedWorkspacePath) {
    return WORKSPACE_TRIE_TOKEN;
  }
  const relativePath = rpath.relative(normalizedWorkspacePath, normalizePath);
  return `${WORKSPACE_TRIE_TOKEN}/${relativePath}`;
}

export const defaultConfig = {
  host: "host",
  port: 22,
  username: "username",
  password: "password",
  protocol: "sftp",
  privateKeyPath: null,
  passphrase: null,

  remotePath: "/home",
  uploadOnSave: false,

  syncMode: 'update',

  ignore: [
    "/**/.vscode",
    "/**/.git",
    "/**/.DS_Store",
  ],
};

export const configFileName = '.sftpConfig.json';

const configGlobPattern = `/**/${configFileName}`;

function lookUpConfigRootImpl(activityPath: string, root: string) {
  const configFilePath = path.join(activityPath, configFileName);
  return fse.pathExists(configFilePath)
    .then(exist => {
			if (exist) {
				return activityPath;
			}

      if (!~activityPath.indexOf(root)) {
        throw new Error('config file not found');
      }

			return lookUpConfigRootImpl(path.resolve(activityPath, '..'), root);
		});
}

const lookUpConfigRoot = memoize(lookUpConfigRootImpl);

export function addConfig(configPath) {
  return fse.readJson(configPath)
    .then(config => {
      const configRoot = path.dirname(configPath);
      return configTrie.add(getPathRelativeWorkspace(configRoot), {
        ...config,
        configRoot,
      });
    });
}

export function initConfigs() {
  return new Promise((resolve, reject) => {
    glob(configGlobPattern, {
      cwd: vscode.workspace.rootPath,
      root: vscode.workspace.rootPath,
      nodir: true,
    }, (error, files) => {
      if (error) {
        reject(error);
        return;
      }

      configTrie = new Trie({});

      Promise.all(files.map(addConfig)).then(resolve);
    });
  });
}

export function getDefaultConfigPath() {
  return `${vscode.workspace.rootPath}/${configFileName}`;
};

export function fillPattern(pattern, rootPath) {
  return path.join(rootPath, pattern);
}

export function getConfig(activityPath: string) {
  const config = configTrie.findPrefix(getPathRelativeWorkspace(activityPath));
  if (!config) {
    throw new Error('config file not found');
  }
  return {
    ...defaultConfig,
    ...config,
    ignore: config.ignore.map(pattern => fillPattern(pattern, config.configRoot)),
    remotePath: rpath.join(config.remotePath, normalize(path.relative(config.configRoot, activityPath))),
  };
};

export function newConfig() {
	if (!vscode.workspace.rootPath) {
		output.onError('Cannot run this command without opened folder', 'config');
	}
	
	const defaultConfigPath = getDefaultConfigPath();

	const showConfigFile = () =>
		vscode.workspace.openTextDocument(defaultConfigPath)
			.then(vscode.window.showTextDocument);

	fse.pathExists(defaultConfigPath)
		.then(exist => {
			if (exist) {
				return showConfigFile()
			}

			return fse.writeJson(defaultConfigPath, defaultConfig, { spaces: 4 })
				.then(showConfigFile)
		})
		.catch(error => {
			output.onError(error, 'config');
		});
}

export function getHostInfo(config) {
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    privateKeyPath: config.privateKeyPath,
    passphrase: config.passphrase,
  };
}
