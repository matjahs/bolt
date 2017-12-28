// @flow
import semver from 'semver';
import Project from '../Project';
import Config from '../Config';
import type Workspace from '../Workspace';
import type Package from '../Package';
import * as messages from './messages';
import { BoltError } from './errors';
import * as logger from './logger';
import { BOLT_VERSION } from '../constants';

export default async function validateProject(project: Project) {
  let workspaces = await project.getWorkspaces();
  let projectDependencies = project.pkg.getAllDependencies();
  let projectConfig = project.pkg.config;
  // let { graph: depGraph } = await project.getDepGraph(workspaces);

  let projectIsValid = true;

  // If the project has an engines.bolt field we must respect it
  let boltConfigVersion = projectConfig.getBoltConfigVersion();
  if (boltConfigVersion) {
    if (!semver.satisfies(BOLT_VERSION, boltConfigVersion)) {
      logger.error(
        messages.invalidBoltVersion(BOLT_VERSION, boltConfigVersion)
      );
      projectIsValid = false;
    }
  }

  // Workspaces should never appear as dependencies in the Project config
  for (let workspace of workspaces) {
    let depName = workspace.pkg.config.getName();
    if (projectDependencies.has(depName)) {
      logger.error(messages.projectCannotDependOnWorkspace(depName));
      projectIsValid = false;
    }
  }

  /**
   *     <More Project checks here>
   */

  return projectIsValid;
}
