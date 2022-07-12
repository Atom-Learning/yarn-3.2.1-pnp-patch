As described in @yarnpkg/berry [Issue #1818](https://github.com/yarnpkg/berry/issues/1818), using Yarn 3.2.1 with Node 18 can sometimes throw the following error:

```log
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received an instance of Buffer
    at new NodeError (node:internal/errors:388:5)
    at validateString (node:internal/validators:114:11)
    at Object.isAbsolute (node:path:1157:5)
    at VirtualFS.mapToBase (.../Code/nest-vue/.pnp.cjs:31524:24)
    at VirtualFS.rmdirSync (.../Code/nest-vue/.pnp.cjs:31367:39)
    at PosixFS.rmdirSync (.../Code/nest-vue/.pnp.cjs:31367:24)
    at URLFS.rmdirSync (.../Code/nest-vue/.pnp.cjs:31367:24)
    at _rmdirSync (node:internal/fs/rimraf:260:21)
    at rimrafSync (node:internal/fs/rimraf:193:7)
    at node:internal/fs/rimraf:253:9 {
  code: 'ERR_INVALID_ARG_TYPE'
}
```

This repo patches `sources/hook.js` in @yarnpkg/pnp, which provides the template for the `.pnp.cjs` file where the issue arises, based on the [temporary fix provided by vicary](https://github.com/yarnpkg/berry/issues/1818#issuecomment-1065829365).

Because yarn runs from a compiled release file in your local repository at `./.yarn/releases/yarn-*-.cjs`, the patch has to be compiled into the release. Do this in your local project by running

```bash
yarn set version from sources --repository https://github.com/Atom-Learning/yarn-3.2.1-pnp-patch
```

[Read more about `yarn set version from sources`](https://yarnpkg.com/cli/set/version/from/sources).
