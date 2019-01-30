const cp = require(`child_process`);
const {existsSync, statSync, stat, rename, readdir, remove} = require(`fs-extra`);
const {relative, isAbsolute} = require(`path`);
const {satisfies} = require(`semver`);

const {
  fs: {createTemporaryFolder, readFile, readJson, writeFile, writeJson},
  tests: {getPackageDirectoryPath, testIf},
} = require(`pkg-tests-core`);

describe(`Plug'n'Play`, () => {
  test(
    `it should not touch the .pnp.js file when it already exists and is up-to-date`,
    makeTemporaryEnv(
      {},
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        const beforeTime = (await stat(`${path}/.pnp.js`)).mtimeMs;

        // Need to wait two seconds to be sure that the mtime will change
        await new Promise(resolve => setTimeout(resolve, 2000));

        await run(`install`);

        const afterTime = (await stat(`${path}/.pnp.js`)).mtimeMs;

        expect(afterTime).toEqual(beforeTime);
      },
    ),
  );

  test(
    `it should update the .pnp.js file when it already exists but isn't up-to-date`,
    makeTemporaryEnv(
      {},
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        const beforeTime = (await stat(`${path}/.pnp.js`)).mtimeMs;

        await writeJson(`${path}/package.json`, {
          dependencies: {
            [`no-deps`]: `1.0.0`,
          },
        });

        // Need to wait two seconds to be sure that the mtime will change
        await new Promise(resolve => setTimeout(resolve, 2000));

        await run(`install`);

        const afterTime = (await stat(`${path}/.pnp.js`)).mtimeMs;

        expect(afterTime).not.toEqual(beforeTime);
      },
    ),
  );

  test(
    `it should resolve two identical packages with the same object (easy)`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`one-fixed-dep-1`]: getPackageDirectoryPath(`one-fixed-dep`, `1.0.0`),
          [`one-fixed-dep-2`]: getPackageDirectoryPath(`one-fixed-dep`, `1.0.0`),
          [`no-deps`]: `1.0.0`,
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await expect(
          source(`require('one-fixed-dep-1').dependencies['no-deps'] === require('no-deps')`),
        ).resolves.toEqual(true);
        await expect(
          source(`require('one-fixed-dep-2').dependencies['no-deps'] === require('no-deps')`),
        ).resolves.toEqual(true);
      },
    ),
  );

  test(
    `it should resolve two identical packages with the same object (complex)`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`one-fixed-dep-1`]: getPackageDirectoryPath(`one-fixed-dep`, `1.0.0`),
          [`one-fixed-dep-2`]: getPackageDirectoryPath(`one-fixed-dep`, `1.0.0`),
          [`no-deps`]: `2.0.0`,
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await expect(
          source(
            `require('one-fixed-dep-1').dependencies['no-deps'] === require('one-fixed-dep-2').dependencies['no-deps']`,
          ),
        ).resolves.toEqual(true);

        await expect(
          source(`require('one-fixed-dep-1').dependencies['no-deps'] !== require('no-deps')`),
        ).resolves.toEqual(true);
        await expect(
          source(`require('one-fixed-dep-2').dependencies['no-deps'] !== require('no-deps')`),
        ).resolves.toEqual(true);
      },
    ),
  );

  test(
    `it should correctly resolve native Node modules`,
    makeTemporaryEnv(
      {},
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await expect(source(`require('fs') ? true : false`)).resolves.toEqual(true);
      },
    ),
  );

  test(
    `it should correctly resolve relative imports`,
    makeTemporaryEnv(
      {},
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await writeFile(`${path}/foo.js`, `module.exports = 42;\n`);

        await run(`install`);

        await expect(source(`require('./foo.js')`)).resolves.toEqual(42);
      },
    ),
  );

  test(
    `it should correctly resolve deep imports`,
    makeTemporaryEnv(
      {
        dependencies: {[`various-requires`]: `1.0.0`},
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await expect(source(`require('various-requires/alternative-index')`)).resolves.toEqual(42);
      },
    ),
  );

  test(
    `it should correctly resolve relative imports from within dependencies`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`various-requires`]: `1.0.0`,
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await expect(source(`require('various-requires/relative-require')`)).resolves.toEqual(42);
      },
    ),
  );

  test(
    `it should correctly resolve an absolute path even when the issuer doesn't exist`,
    makeTemporaryEnv({}, {plugNPlay: true}, async ({path, run, source}) => {
      await run(`install`);

      const api = require(`${path}/.pnp.js`);
      api.resolveToUnqualified(`${path}/.pnp.js`, `${path}/some/path/that/doesnt/exists/please/`);
    }),
  );

  test(
    `it should fallback to the top-level dependencies when it cannot require a transitive dependency require`,
    makeTemporaryEnv(
      {dependencies: {[`various-requires`]: `1.0.0`, [`no-deps`]: `1.0.0`}},
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await expect(source(`require('various-requires/invalid-require')`)).resolves.toMatchObject({
          name: `no-deps`,
          version: `1.0.0`,
        });
      },
    ),
  );

  test(
    `it should throw an exception if a dependency tries to require something it doesn't own`,
    makeTemporaryEnv(
      {dependencies: {[`various-requires`]: `1.0.0`}},
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await expect(source(`require('various-requires/invalid-require')`)).rejects.toBeTruthy();
      },
    ),
  );

  test(
    `it should allow packages to require themselves`,
    makeTemporaryEnv(
      {
        dependencies: {[`various-requires`]: `1.0.0`},
      },
      {plugNPlay: true},
      async ({path, run, source}) => {
        await run(`install`);

        await expect(source(`require('various-requires/self') === require('various-requires')`)).resolves.toEqual(true);
      },
    ),
  );

  test(
    `it should not add the implicit self dependency if an explicit one already exists`,
    makeTemporaryEnv(
      {
        dependencies: {[`self-require-trap`]: `1.0.0`},
      },
      {plugNPlay: true},
      async ({path, run, source}) => {
        await run(`install`);

        await expect(source(`require('self-require-trap/self') !== require('self-require-trap')`)).resolves.toEqual(
          true,
        );
      },
    ),
  );

  test(
    `it should run scripts using a Node version that auto-injects the hook`,
    makeTemporaryEnv(
      {
        dependencies: {[`no-deps`]: `1.0.0`},
        scripts: {myScript: `node -p "require('no-deps/package.json').version"`},
      },
      {
        plugNPlay: true,
      },
      async ({path, run}) => {
        await run(`install`);

        await expect(run(`myScript`)).resolves.toMatchObject({
          stdout: `1.0.0\n`,
        });
      },
    ),
  );

  test(
    `it should install in such a way that two identical packages with different peer dependencies are different instances`,
    makeTemporaryEnv(
      {
        dependencies: {[`provides-peer-deps-1-0-0`]: `1.0.0`, [`provides-peer-deps-2-0-0`]: `1.0.0`},
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await expect(
          source(`require('provides-peer-deps-1-0-0') !== require('provides-peer-deps-2-0-0')`),
        ).resolves.toEqual(true);

        await expect(source(`require('provides-peer-deps-1-0-0')`)).resolves.toMatchObject({
          name: `provides-peer-deps-1-0-0`,
          version: `1.0.0`,
          dependencies: {
            [`peer-deps`]: {
              name: `peer-deps`,
              version: `1.0.0`,
              peerDependencies: {
                [`no-deps`]: {
                  name: `no-deps`,
                  version: `1.0.0`,
                },
              },
            },
            [`no-deps`]: {
              name: `no-deps`,
              version: `1.0.0`,
            },
          },
        });

        await expect(source(`require('provides-peer-deps-2-0-0')`)).resolves.toMatchObject({
          name: `provides-peer-deps-2-0-0`,
          version: `1.0.0`,
          dependencies: {
            [`peer-deps`]: {
              name: `peer-deps`,
              version: `1.0.0`,
              peerDependencies: {
                [`no-deps`]: {
                  name: `no-deps`,
                  version: `2.0.0`,
                },
              },
            },
            [`no-deps`]: {
              name: `no-deps`,
              version: `2.0.0`,
            },
          },
        });
      },
    ),
  );

  test(
    `it should support the use case of using the result of require.resolve(...) to load a package`,
    makeTemporaryEnv(
      {
        dependencies: {[`custom-dep-a`]: `file:./custom-dep-a`},
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await writeFile(
          `${path}/custom-dep-a/index.js`,
          `module.exports = require('custom-dep-b')(require.resolve('no-deps'))`,
        );
        await writeJson(`${path}/custom-dep-a/package.json`, {
          name: `custom-dep-a`,
          version: `1.0.0`,
          dependencies: {[`custom-dep-b`]: `file:../custom-dep-b`, [`no-deps`]: `1.0.0`},
        });

        await writeFile(`${path}/custom-dep-b/index.js`, `module.exports = path => require(path)`);
        await writeJson(`${path}/custom-dep-b/package.json`, {name: `custom-dep-b`, version: `1.0.0`});

        await run(`install`);

        await expect(source(`require('custom-dep-a')`)).resolves.toMatchObject({
          name: `no-deps`,
          version: `1.0.0`,
        });
      },
    ),
  );

  test(
    `it should not break the tree path when loading through the result of require.resolve(...)`,
    makeTemporaryEnv(
      {
        dependencies: {[`custom-dep-a`]: `file:./custom-dep-a`},
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await writeFile(
          `${path}/custom-dep-a/index.js`,
          `module.exports = require('custom-dep-b')(require.resolve('custom-dep-c'))`,
        );
        await writeJson(`${path}/custom-dep-a/package.json`, {
          name: `custom-dep-a`,
          version: `1.0.0`,
          dependencies: {[`custom-dep-b`]: `file:../custom-dep-b`, [`custom-dep-c`]: `file:../custom-dep-c`},
        });

        await writeFile(`${path}/custom-dep-b/index.js`, `module.exports = path => require(path)`);
        await writeJson(`${path}/custom-dep-b/package.json`, {name: `custom-dep-b`, version: `1.0.0`});

        await writeFile(`${path}/custom-dep-c/index.js`, `module.exports = require('no-deps')`);
        await writeJson(`${path}/custom-dep-c/package.json`, {
          name: `custom-dep-c`,
          version: `1.0.0`,
          dependencies: {[`no-deps`]: `1.0.0`},
        });

        await run(`install`);

        await expect(source(`require('custom-dep-a')`)).resolves.toMatchObject({
          name: `no-deps`,
          version: `1.0.0`,
        });
      },
    ),
  );

  if (satisfies(process.versions.node, `>=8.9.0`)) {
    test(
      `it should support the 'paths' option from require.resolve (same dependency tree)`,
      makeTemporaryEnv(
        {
          private: true,
          workspaces: [`workspace-*`],
        },
        {
          plugNPlay: true,
        },
        async ({path, run, source}) => {
          await writeJson(`${path}/workspace-a/package.json`, {
            name: `workspace-a`,
            version: `1.0.0`,
            dependencies: {[`no-deps`]: `1.0.0`},
          });

          await writeJson(`${path}/workspace-b/package.json`, {
            name: `workspace-b`,
            version: `1.0.0`,
            dependencies: {[`no-deps`]: `2.0.0`, [`one-fixed-dep`]: `1.0.0`},
          });

          await run(`install`);

          await expect(
            source(
              `require(require.resolve('no-deps', {paths: ${JSON.stringify([
                `${path}/workspace-a`,
                `${path}/workspace-b`,
              ])}}))`,
            ),
          ).resolves.toMatchObject({
            name: `no-deps`,
            version: `1.0.0`,
          });
        },
      ),
    );

    // Skipped because not supported (we can't require files from within other dependency trees, since we couldn't
    // reconcile them together: dependency tree A could think that package X has deps Y@1 while dependency tree B
    // could think that X has deps Y@2 instead. Since they would share the same location on the disk, PnP wouldn't
    // be able to tell which one should be used)
    test.skip(
      `it should support the 'paths' option from require.resolve (different dependency trees)`,
      makeTemporaryEnv(
        {
          dependencies: {},
        },
        {
          plugNPlay: true,
        },
        async ({path, run, source}) => {
          await run(`install`);

          const tmpA = await createTemporaryFolder();
          const tmpB = await createTemporaryFolder();

          await writeJson(`${tmpA}/package.json`, {
            dependencies: {[`no-deps`]: `1.0.0`},
          });

          await writeJson(`${tmpB}/package.json`, {
            dependencies: {[`no-deps`]: `2.0.0`, [`one-fixed-dep`]: `1.0.0`},
          });

          await run(`install`, {
            cwd: tmpA,
          });

          await run(`install`, {
            cwd: tmpB,
          });

          await expect(
            source(`require(require.resolve('no-deps', {paths: ${JSON.stringify([tmpA, tmpB])}}))`),
          ).resolves.toMatchObject({
            name: `no-deps`,
            version: `1.0.0`,
          });
        },
      ),
    );

    test(
      `using require.resolve with unsupported options should throw`,
      makeTemporaryEnv(
        {
          dependencies: {[`no-deps`]: `1.0.0`},
        },
        {
          plugNPlay: true,
        },
        async ({path, run, source}) => {
          await run(`install`);

          await expect(source(`require.resolve('no-deps', {foobar: 42})`)).rejects.toBeTruthy();
        },
      ),
    );
  }

  test(
    `it should load the index.js file when loading from a folder`,
    makeTemporaryEnv({}, {plugNPlay: true}, async ({path, run, source}) => {
      await run(`install`);

      const tmp = await createTemporaryFolder();

      await writeFile(`${tmp}/folder/index.js`, `module.exports = 42;`);

      await expect(source(`require(${JSON.stringify(tmp)} + "/folder")`)).resolves.toEqual(42);
    }),
  );

  test(
    `it should resolve the .js extension`,
    makeTemporaryEnv({}, {plugNPlay: true}, async ({path, run, source}) => {
      await run(`install`);

      const tmp = await createTemporaryFolder();

      await writeFile(`${tmp}/file.js`, `module.exports = 42;`);

      await expect(source(`require(${JSON.stringify(tmp)} + "/file")`)).resolves.toEqual(42);
    }),
  );

  test(
    `it should ignore the "main" entry if it doesn't resolve`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`invalid-main`]: `1.0.0`,
        },
      },
      {plugNPlay: true},
      async ({path, run, source}) => {
        await run(`install`);

        await expect(source(`require("invalid-main")`)).resolves.toMatchObject({
          name: `invalid-main`,
          version: `1.0.0`,
        });
      },
    ),
  );

  test(
    `it should use the regular Node resolution when requiring files outside of the pnp install tree`,
    makeTemporaryEnv({}, {plugNPlay: true}, async ({path, run, source}) => {
      await run(`install`);

      const tmp = await createTemporaryFolder();

      await writeFile(`${tmp}/node_modules/dep/index.js`, `module.exports = 42;`);
      await writeFile(`${tmp}/index.js`, `require('dep')`);

      await source(`require(${JSON.stringify(tmp)} + "/index.js")`);
    }),
  );

  test(
    `it should allow scripts outside of the dependency tree to require files within the dependency tree`,
    makeTemporaryEnv(
      {dependencies: {[`no-deps`]: `1.0.0`}},
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        const tmp = await createTemporaryFolder();

        await writeFile(`${tmp}/index.js`, `require(process.argv[2])`);
        await writeFile(`${path}/index.js`, `require('no-deps')`);

        await run(`node`, `${tmp}/index.js`, `${path}/index.js`);
      },
    ),
  );

  test(
    `it should export the PnP API through the 'pnpapi' name`,
    makeTemporaryEnv(
      {},
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await expect(source(`typeof require('pnpapi').VERSIONS.std`)).resolves.toEqual(`number`);
      },
    ),
  );

  test(
    `it should expose the PnP version through 'process.versions.pnp'`,
    makeTemporaryEnv({}, {plugNPlay: true}, async ({path, run, source}) => {
      await run(`install`);

      const pnpapiVersionsStd = await source(`require('pnpapi').VERSIONS.std`);
      const processVersionsPnp = await source(`process.versions.pnp`);

      await expect(typeof processVersionsPnp).toEqual(`string`);
      await expect(processVersionsPnp).toEqual(String(pnpapiVersionsStd));
    }),
  );

  testIf(
    () => process.platform !== 'win32',
    `it should generate a file that can be used as an executable to resolve a request (valid request)`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`no-deps`]: `1.0.0`,
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        expect(statSync(`${path}/.pnp.js`).mode & 0o111).toEqual(0o111);

        const result = JSON.parse(cp.execFileSync(`${path}/.pnp.js`, [`no-deps`, `${path}/`], {encoding: `utf-8`}));

        expect(result[0]).toEqual(null);
        expect(typeof result[1]).toEqual(`string`);

        expect(require(result[1])).toMatchObject({
          name: `no-deps`,
          version: `1.0.0`,
        });
      },
    ),
  );

  testIf(
    () => process.platform !== `win32`,
    `it should generate a file that can be used as an executable to resolve a request (builtin request)`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`no-deps`]: `1.0.0`,
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        expect(statSync(`${path}/.pnp.js`).mode & 0o111).toEqual(0o111);

        const result = JSON.parse(cp.execFileSync(`${path}/.pnp.js`, [`fs`, `${path}/`], {encoding: `utf-8`}));

        expect(result[0]).toEqual(null);
        expect(result[1]).toEqual(null);
      },
    ),
  );

  testIf(
    () => process.platform !== `win32`,
    `it should generate a file that can be used as an executable to resolve a request (invalid request)`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`no-deps`]: `1.0.0`,
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        expect(statSync(`${path}/.pnp.js`).mode & 0o111).toEqual(0o111);

        const result = JSON.parse(
          cp.execFileSync(`${path}/.pnp.js`, [`doesnt-exists`, `${path}/`], {encoding: `utf-8`}),
        );

        expect(typeof result[0].code).toEqual(`string`);
        expect(typeof result[0].message).toEqual(`string`);

        expect(result[1]).toEqual(null);
      },
    ),
  );

  test(
    `it should generate a file with a custom shebang if configured as such`,
    makeTemporaryEnv(
      {},
      {
        plugNPlay: true,
        plugnplayShebang: `#!foo`,
      },
      async ({path, run, source}) => {
        await run(`install`);

        const pnpJs = await readFile(`${path}/.pnp.js`, `utf8`);

        expect(pnpJs.replace(/\n.*/s, ``)).toMatch(/^#!foo$/);
      },
    ),
  );

  it(
    `it should not be enabled for paths matching the specified regex`,
    makeTemporaryEnv(
      {},
      {
        plugNPlay: true,
        plugnplayBlacklist: `/foo/`,
      },
      async ({path, run, source}) => {
        await writeFile(`${path}/foo/shouldwork.js`, `module.exports = require('bad-dep');\n`);
        await writeFile(`${path}/doesntwork.js`, `module.exports = require('bad-dep');\n`);

        await run(`install`);

        // Force it to exist so that the two scripts would succeed if using the node resolution
        await writeFile(`${path}/node_modules/bad-dep/index.js`, `module.exports = 42;\n`);

        await expect(source(`require('./doesntwork')`)).rejects.toBeTruthy();
        await expect(source(`require('./foo/shouldwork')`)).resolves.toBeTruthy();
      },
    ),
  );

  it(
    `it should not break relative requires for files within a blacklist`,
    makeTemporaryEnv(
      {},
      {
        plugNPlay: true,
        plugnplayBlacklist: `/foo/`,
      },
      async ({path, run, source}) => {
        await writeFile(`${path}/foo/filea.js`, `module.exports = require('./fileb');\n`);
        await writeFile(`${path}/foo/fileb.js`, `module.exports = 42;\n`);

        await run(`install`);

        await expect(source(`require('./foo/filea')`)).resolves.toEqual(42);
      },
    ),
  );

  test(
    `it should install the packages within a node_modules directory (even if within the cache)`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`no-deps`]: `1.0.0`,
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        // This is to allow a maximal compatibility with packages that expect to
        // be located inside a node_modules directory. Various tools (such as
        // transpilers) also use regexps in their configuration that it would be
        // nice not to break.

        await run(`install`);

        expect(await source(`require.resolve('no-deps')`)).toMatch(/[\\\/]node_modules[\\\/]no-deps[\\\/]/);
      },
    ),
  );

  test(
    `it should install packages with peer dependencies within a node_modules directory (even if within the .pnp folder)`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`peer-deps`]: `1.0.0`,
          [`no-deps`]: `2.0.0`,
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        // This is to allow a maximal compatibility with packages that expect to
        // be located inside a node_modules directory. Various tools (such as
        // transpilers) also use regexps in their configuration that it would be
        // nice not to break.

        await run(`install`);

        expect(await source(`require.resolve('peer-deps')`)).toMatch(/[\\\/]node_modules[\\\/]peer-deps[\\\/]/);
      },
    ),
  );

  test(
    `it should make it possible to copy the pnp file and cache from one place to another`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`no-deps`]: `1.0.0`,
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await makeTemporaryEnv(
          {
            [`no-deps`]: `1.0.0`,
          },
          {
            plugNPlay: true,
          },
          async ({path: path2, run: run2, source: source2}) => {
            // Move the install artifacts into a new location
            // If the .pnp.js file references absolute paths, they will stop working
            await rename(`${path}/.berry`, `${path2}/.berry`);
            await rename(`${path}/.pnp.js`, `${path2}/.pnp.js`);

            await expect(source2(`require('no-deps')`)).resolves.toMatchObject({
              name: `no-deps`,
              version: `1.0.0`,
            });
          },
        )();
      },
    ),
  );

  test(
    `it should generate the same hooks for two projects with the same configuration`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`no-deps`]: `1.0.0`,
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await makeTemporaryEnv(
          {
            dependencies: {
              [`no-deps`]: `1.0.0`,
            },
          },
          {
            plugNPlay: true,
          },
          async ({path: path2, run: run2, source: source2}) => {
            expect(path2).not.toEqual(path);

            await run2(`install`);

            expect(readFile(`${path2}/.pnp.js`, `utf8`)).resolves.toEqual(await readFile(`${path}/.pnp.js`, `utf8`));
          },
        )();
      },
    ),
  );

  test(
    `it should allow unplugging a simple package from a pnp installation`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`no-deps`]: `1.0.0`,
        },
        dependenciesMeta: {
          [`no-deps`]: {
            unplugged: true,
          },
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        const listing = await readdir(`${path}/.berry/pnp/unplugged`);
        expect(listing).toHaveLength(1);

        await writeFile(
          `${path}/.berry/pnp/unplugged/${listing[0]}/node_modules/no-deps/index.js`,
          `module.exports = "unplugged";\n`,
        );

        await expect(source(`require('no-deps')`)).resolves.toEqual('unplugged');
      },
    ),
  );

  test(
    `it should allow unplugging a deep package from a pnp installation`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`one-fixed-dep`]: `1.0.0`,
        },
        dependenciesMeta: {
          [`no-deps`]: {
            unplugged: true,
          },
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        const listing = await readdir(`${path}/.berry/pnp/unplugged`);
        expect(listing).toHaveLength(1);

        await writeFile(
          `${path}/.berry/pnp/unplugged/${listing[0]}/node_modules/no-deps/index.js`,
          `module.exports = "unplugged";\n`,
        );

        await expect(source(`require('one-fixed-dep')`)).resolves.toMatchObject({
          dependencies: {
            [`no-deps`]: `unplugged`,
          },
        });
      },
    ),
  );

  test(
    `it should allow unplugging multiple identically named packages from a pnp installation`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`one-fixed-dep`]: `1.0.0`,
          [`no-deps`]: `2.0.0`,
        },
        dependenciesMeta: {
          [`no-deps`]: {
            unplugged: true,
          },
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        const listing = await readdir(`${path}/.berry/pnp/unplugged`);
        expect(listing).toHaveLength(2);
      },
    ),
  );

  test(
    `it should allow picking the unplugged packages by locator`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`one-fixed-dep`]: `1.0.0`,
          [`no-deps`]: `2.0.0`,
        },
        dependenciesMeta: {
          [`no-deps@1.0.0`]: {
            unplugged: true,
          },
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        const listing = await readdir(`${path}/.berry/pnp/unplugged`);
        expect(listing).toHaveLength(1);

        expect(listing[0]).toMatch(/1.0.0/);
      },
    ),
  );

  test(
    `it should properly unplug a package with peer dependencies`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`provides-peer-deps-1-0-0`]: `1.0.0`,
          [`provides-peer-deps-2-0-0`]: `1.0.0`,
        },
        dependenciesMeta: {
          [`no-deps`]: {
            unplugged: true,
          },
          [`peer-deps`]: {
            unplugged: true,
          },
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        await expect(
          source(`require('provides-peer-deps-1-0-0') !== require('provides-peer-deps-2-0-0')`),
        ).resolves.toEqual(true);

        await expect(source(`require('provides-peer-deps-1-0-0')`)).resolves.toMatchObject({
          name: `provides-peer-deps-1-0-0`,
          version: `1.0.0`,
          dependencies: {
            [`peer-deps`]: {
              name: `peer-deps`,
              version: `1.0.0`,
              peerDependencies: {
                [`no-deps`]: {
                  name: `no-deps`,
                  version: `1.0.0`,
                },
              },
            },
            [`no-deps`]: {
              name: `no-deps`,
              version: `1.0.0`,
            },
          },
        });

        await expect(source(`require('provides-peer-deps-2-0-0')`)).resolves.toMatchObject({
          name: `provides-peer-deps-2-0-0`,
          version: `1.0.0`,
          dependencies: {
            [`peer-deps`]: {
              name: `peer-deps`,
              version: `1.0.0`,
              peerDependencies: {
                [`no-deps`]: {
                  name: `no-deps`,
                  version: `2.0.0`,
                },
              },
            },
            [`no-deps`]: {
              name: `no-deps`,
              version: `2.0.0`,
            },
          },
        });
      },
    ),
  );

  test(
    `it should not override an already unplugged package`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`no-deps`]: `1.0.0`,
        },
        dependenciesMeta: {
          [`no-deps`]: {
            unplugged: true,
          },
        },
      },
      {
        plugNPlay: true,
      },
      async ({path, run, source}) => {
        await run(`install`);

        const listing = await readdir(`${path}/.berry/pnp/unplugged`);
        expect(listing).toHaveLength(1);

        await writeFile(
          `${path}/.berry/pnp/unplugged/${listing[0]}/node_modules/no-deps/index.js`,
          `module.exports = "unplugged";\n`,
        );

        await run(`install`);

        await expect(source(`require('no-deps')`)).resolves.toEqual(`unplugged`);
      },
    ),
  );

  test(
    `it should not automatically unplug all packages`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`no-deps`]: `1.0.0`,
        },
      },
      {plugNPlay: true},
      async ({path, run, source}) => {
        await run(`install`);

        expect(existsSync(`${path}/.berry/pnp/unplugged`)).toEqual(false);
      },
    ),
  );

  test(
    `it should automatically unplug packages with postinstall scripts`,
    makeTemporaryEnv(
      {
        dependencies: {[`no-deps-scripted`]: `1.0.0`},
      },
      {plugNPlay: true},
      async ({path, run, source}) => {
        await run(`install`);

        const listing = await readdir(`${path}/.berry/pnp/unplugged`);
        expect(listing).toHaveLength(1);
      },
    ),
  );

  test(
    `it should not cache the postinstall artifacts`,
    makeTemporaryEnv(
      {
        dependencies: {[`no-deps-scripted`]: `1.0.0`},
      },
      {plugNPlay: true},
      async ({path, run, source}) => {
        await run(`install`);

        const rndBefore = await source(`require('no-deps-scripted/rnd.js')`);

        await remove(`${path}/.berry`);
        await remove(`${path}/.pnp.js`);

        await run(`install`);

        const rndAfter = await source(`require('no-deps-scripted/rnd.js')`);

        // It might fail once every blue moon, when the two random numbers are equal
        expect(rndAfter).not.toEqual(rndBefore);
      },
    ),
    15000,
  );

  test(
    `it should not break spawning new Node processes ('node' command)`,
    makeTemporaryEnv(
      {
        dependencies: {[`no-deps`]: `1.0.0`},
      },
      {plugNPlay: true},
      async ({path, run, source}) => {
        await run(`install`);

        await writeFile(`${path}/script.js`, `console.log(JSON.stringify(require('no-deps')))`);

        await expect(
          source(
            `JSON.parse(require('child_process').execFileSync(process.execPath, [${JSON.stringify(
              `${path}/script.js`,
            )}]).toString())`,
          ),
        ).resolves.toMatchObject({
          name: `no-deps`,
          version: `1.0.0`,
        });
      },
    ),
  );

  test(
    `it should not break spawning new Node processes ('run' command)`,
    makeTemporaryEnv(
      {
        dependencies: {[`no-deps`]: `1.0.0`},
        scripts: {[`script`]: `node main.js`},
      },
      {plugNPlay: true},
      async ({path, run, source}) => {
        await run(`install`);

        await writeFile(`${path}/sub.js`, `console.log(JSON.stringify(require('no-deps')))`);
        await writeFile(
          `${path}/main.js`,
          `console.log(require('child_process').execFileSync(process.execPath, [${JSON.stringify(
            `${path}/sub.js`,
          )}]).toString())`,
        );

        expect(JSON.parse((await run(`run`, `script`)).stdout)).toMatchObject({
          name: `no-deps`,
          version: `1.0.0`,
        });
      },
    ),
  );

  test(
    `it should properly forward the NODE_OPTIONS environment variable`,
    makeTemporaryEnv({}, {plugNPlay: true}, async ({path, run, source}) => {
      await run(`install`);

      await writeFile(`${path}/foo.js`, `console.log(42);`);

      await expect(
        run(`node`, `-e`, `console.log(21);`, {env: {NODE_OPTIONS: `--require ${path}/foo`}}),
      ).resolves.toMatchObject({
        // Note that '42' is present twice: the first one because Node executes Yarn, and the second one because Yarn spawns Node
        stdout: `42\n42\n21\n`,
      });
    }),
  );

  test(
    `it should transparently support the "resolve" package`,
    makeTemporaryEnv(
      {
        dependencies: {
          [`resolve`]: `1.9.0`,
        },
      },
      {plugNPlay: true},
      async ({path, run, source}) => {
        await run(`install`);

        await expect(source(`require('resolve').sync('resolve')`)).resolves.toEqual(
          await source(`require.resolve('resolve')`),
        );
      },
    ),
    15000,
  );
});
