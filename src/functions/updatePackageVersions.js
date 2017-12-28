// @flow
import semver from 'semver';

import Project from '../Project';
import Workspace from '../Workspace';
import DependencyGraph from '../DependencyGraph';
import * as logger from '../utils/logger';
import * as messages from '../utils/messages';
import includes from 'array-includes';

type VersionMap = {
  [name: string]: string
};

type Options = {
  cwd?: string
};

function versionRangeToRangeType(versionRange: string) {
  if (versionRange.charAt(0) === '^') return '^';
  if (versionRange.charAt(0) === '~') return '~';
  return '';
}

/**
 * This function is used to update all the internal dependencies where you have an external source
 * bumping updated packages (a tool like bolt-releases for example).
 * It takes an object of packageNames and their new updated packages. updatePackageVersions will update all
 * internal updated packages of packages according to those new updated packages.
 * ie, a caret dep, will remain a caret dep and a pinned dep will remain pinned.
 *
 * Note: we explicitly ignore all external dependencies passed and warn if they are.
 *
 * It is up to the consumer to ensure that these new updated packages are not going to leave the repo in an
 * inconsistent state (internal deps leaving semver ranges). This can occur if your
 * updated packages will not release all packages that need to be.
 *
 */

export default async function updatePackageVersions(
  updatedPackages: VersionMap,
  opts: Options = {}
): Promise<Array<string>> {
  let cwd = opts.cwd || process.cwd();
  let project: Project = await Project.init(cwd);
  let workspaces = await project.getWorkspaces();
  let graph = new DependencyGraph(project, workspaces);
  let editedPackages = new Set();

  let internalDeps = Object.keys(updatedPackages).filter(dep =>
    graph.getDepsByName(dep)
  );

  let externalDeps = Object.keys(updatedPackages).filter(
    dep => !graph.getDepsByName(dep)
  );

  if (externalDeps.length !== 0) {
    logger.warn(
      messages.externalDepsPassedToUpdatePackageVersions(externalDeps)
    );
  }

  for (let workspace of workspaces) {
    let pkg = workspace.pkg;
    let promises = [];
    let name = workspace.pkg.config.getName();

    for (let depName of internalDeps) {
      let depRange = String(pkg.getDependencyVersionRange(depName));
      let depTypes = pkg.getDependencyTypes(depName);
      let rangeType = versionRangeToRangeType(depRange);
      let newDepRange = rangeType + updatedPackages[depName];
      if (depTypes.length === 0) continue;

      let inUpdatedPackages = includes(internalDeps, name);
      let willLeaveSemverRange = !semver.satisfies(
        updatedPackages[depName],
        depRange
      );
      // This check determines whether the package will be released. If the
      // package will not be released, we throw.
      if (!inUpdatedPackages && willLeaveSemverRange) {
        throw new Error(
          messages.invalidBoltWorkspacesFromUpdate(
            name,
            depName,
            depRange,
            updatedPackages[depName]
          )
        );
      }
      if (!inUpdatedPackages) continue;

      for (let depType of depTypes) {
        await pkg.setDependencyVersionRange(depName, depType, newDepRange);
      }
      editedPackages.add(pkg.filePath);
    }
  }

  return Array.from(editedPackages);
}
