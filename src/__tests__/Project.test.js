// @flow
import path from 'path';
import Project, { type DepGraph } from '../Project';
import Package from '../Package';
import Workspace from '../Workspace';
import DependencyGraph from '../DependencyGraph';
import * as logger from '../utils/logger';
import fixtures from 'fixturez';

const f = fixtures(__dirname);

jest.mock('../utils/logger');

function assertDependencies(graph, pkg, dependencies) {
  let val = graph.get(pkg);
  expect(val && val.dependencies).toEqual(dependencies);
}

type ExpectedDepGraph = {
  [pkgName: string]: {
    dependencies: Array<string>,
    dependents: Array<string>
  }
};

function assertDepGraph(graph: DependencyGraph, expected: ExpectedDepGraph) {
  let actual: ExpectedDepGraph = {};

  for (let [workspace, { dependencies, dependents }] of graph.entries()) {
    actual[workspace.getName()] = {
      dependencies: Array.from(dependencies).map(ws => ws.getName()),
      dependents: Array.from(dependents).map(ws => ws.getName())
    };
  }

  expect(actual).toEqual(expected);
}

// Asserts that a set of workspaces contains all (and only) the expected ones
function assertWorkspaces(workspaces, expectedNames) {
  expect(workspaces.length).toEqual(expectedNames.length);
  expectedNames.forEach(expected => {
    expect(
      workspaces.some(workspace => workspace.pkg.config.getName() === expected)
    );
  });
}

describe('Project', () => {
  let project: Project;

  describe('A simple project', () => {
    beforeEach(async () => {
      let filePath = f.find('simple-project');
      project = await Project.init(filePath);
    });

    it('should be able to create a simple project', async () => {
      expect(project).toBeInstanceOf(Project);
      expect(project.pkg).toBeInstanceOf(Package);
    });

    it('should be able to getWorkspaces', async () => {
      let workspaces = await project.getWorkspaces();
      expect(workspaces.length).toEqual(2);
      expect(workspaces[0]).toBeInstanceOf(Workspace);
    });

    it('should be able to runWorkspaceTasks', async () => {
      let workspaces = await project.getWorkspaces();
      let spy = jest.fn(() => Promise.resolve());

      await project.runWorkspaceTasks(workspaces, spy);

      expect(spy).toHaveBeenCalledTimes(2);
      // should be called with our workspace
      expect(spy.mock.calls[0][0]).toBeInstanceOf(Workspace);
    });
  });

  describe('A project with nested workspaces', () => {
    beforeEach(async () => {
      let filePath = f.find('nested-workspaces');
      project = await Project.init(filePath);
    });

    it('should be able to getWorkspaces (including nested)', async () => {
      let workspaces = await project.getWorkspaces();
      expect(workspaces.length).toEqual(3);
      expect(workspaces[0]).toBeInstanceOf(Workspace);
    });

    it('should be able to getDepGraph', async () => {
      let workspaces = await project.getWorkspaces();
      let graph = new DependencyGraph(project, workspaces);

      expect(graph.isValid()).toEqual(true);

      assertDepGraph(graph, {
        foo: { dependents: [], dependencies: ['bar'] },
        bar: { dependents: ['foo', 'baz'], dependencies: [] },
        baz: { dependents: [], dependencies: ['bar'] }
      });
    });
  });

  describe('A project with nested workspaces and transitive dependents', () => {
    beforeEach(async () => {
      let filePath = f.find('nested-workspaces-transitive-dependents');
      project = await Project.init(filePath);
    });

    it('should be able to getWorkspaces (including nested)', async () => {
      let workspaces = await project.getWorkspaces();
      expect(workspaces.length).toEqual(4);
      expect(workspaces[0]).toBeInstanceOf(Workspace);
    });

    it('should be able to getDepGraph', async () => {
      let workspaces = await project.getWorkspaces();
      let graph = new DependencyGraph(project, workspaces);

      expect(graph.isValid()).toEqual(true);
      assertDepGraph(graph, {
        'pkg-a': { dependents: ['workspace-a', 'pkg-b'], dependencies: [] },
        'workspace-a': { dependents: [], dependencies: ['pkg-a'] },
        'pkg-b': { dependents: ['pkg-c'], dependencies: ['pkg-a'] },
        'pkg-c': { dependents: [], dependencies: ['pkg-b'] }
      });
    });

    it('should be able to getDepGraph', async () => {
      let workspaces = await project.getWorkspaces();
      let graph = new DependencyGraph(project, workspaces);

      expect(graph.isValid()).toEqual(true);
      assertDepGraph(graph, {
        'pkg-a': { dependents: ['workspace-a', 'pkg-b'], dependencies: [] },
        'pkg-b': { dependents: ['pkg-c'], dependencies: ['pkg-a'] },
        'pkg-c': { dependents: [], dependencies: ['pkg-b'] },
        'workspace-a': { dependents: [], dependencies: ['pkg-a'] }
      });
    });
  });

  describe('filtering', () => {
    let cwd;
    let project;
    let workspaces;

    beforeEach(async () => {
      cwd = f.find('nested-workspaces');
      project = project = await Project.init(cwd);
      workspaces = await project.getWorkspaces();
    });

    it('should return all workspaces if no flags passed', async () => {
      let filtered = await project.filterWorkspaces(workspaces, {});

      expect(workspaces).toEqual(filtered);
    });

    describe('filtering by name', () => {
      it('should filter to names that match the `only` flag', async () => {
        let filtered = await project.filterWorkspaces(workspaces, {
          only: 'foo'
        });
        assertWorkspaces(filtered, ['foo']);
      });

      it('should remove names that match the `ignore` flag', async () => {
        let filtered = await project.filterWorkspaces(workspaces, {
          ignore: 'bar'
        });
        assertWorkspaces(filtered, ['foo', 'baz']);
      });

      it('should support combing only and ignore', async () => {
        let filtered = await project.filterWorkspaces(workspaces, {
          only: '*ba*',
          ignore: 'bar'
        });
        assertWorkspaces(filtered, ['bar']);
      });
    });

    describe('filtering by path', () => {
      it('should filter to names that match the `onlyFs` flag', async () => {
        let filtered = await project.filterWorkspaces(workspaces, {
          onlyFs: 'packages/foo'
        });
        assertWorkspaces(filtered, ['foo']);
      });

      it('should not include names that match the `ignoreFs` flag', async () => {
        let filtered = await project.filterWorkspaces(workspaces, {
          ignoreFs: 'packages/foo/**'
        });
        assertWorkspaces(filtered, ['foo', 'bar']);
      });

      it('should be able to combine onlyFs and ignoreFs', async () => {
        let filtered = await project.filterWorkspaces(workspaces, {
          onlyFs: '**/packages/ba*',
          ignoreFs: 'packages/foo/packages/baz'
        });
        assertWorkspaces(filtered, ['bar']);
      });
    });

    it('should be able to combine name and path filters', async () => {
      let filtered = await project.filterWorkspaces(workspaces, {
        only: 'ba*',
        ignoreFs: 'packages/foo/packages/baz'
      });
      assertWorkspaces(filtered, ['bar']);
    });

    it('should support scoped workspaces', async () => {
      cwd = f.find('nested-workspaces-with-scoped-package-names');
      project = project = await Project.init(cwd);
      workspaces = await project.getWorkspaces();

      let filtered = await project.filterWorkspaces(workspaces, {
        only: '**/foo'
      });
      assertWorkspaces(filtered, ['foo']);

      filtered = await project.filterWorkspaces(workspaces, {
        ignore: '**/foo'
      });
      assertWorkspaces(filtered, ['bar', 'baz']);

      filtered = await project.filterWorkspaces(workspaces, {
        onlyFs: '**/packages/ba*',
        ignore: '@scoped/baz'
      });
      assertWorkspaces(filtered, ['bar', 'baz']);
    });
  });

  describe('runWorkspaceTasks()', () => {
    test('independent workspaces', async () => {
      let cwd = f.find('independent-workspaces');
      let project = await Project.init(cwd);
      let workspaces = await project.getWorkspaces();
      let ops = [];

      await project.runWorkspaceTasks(workspaces, async workspace => {
        ops.push('start:' + workspace.pkg.config.getName());
        // wait until next tick
        await Promise.resolve();
        ops.push('end:' + workspace.pkg.config.getName());
      });

      expect(ops).toEqual(['start:bar', 'start:foo', 'end:bar', 'end:foo']);
    });

    test('dependent workspaces', async () => {
      let cwd = f.find('dependent-workspaces');
      let project = await Project.init(cwd);
      let workspaces = await project.getWorkspaces();
      let ops = [];

      await project.runWorkspaceTasks(workspaces, async workspace => {
        ops.push('start:' + workspace.pkg.config.getName());
        // wait until next tick
        await Promise.resolve();
        ops.push('end:' + workspace.pkg.config.getName());
      });

      expect(ops).toEqual(['start:bar', 'end:bar', 'start:foo', 'end:foo']);
    });

    test('dependent workspaces with cycle', async () => {
      let cwd = f.find('dependent-workspaces-with-cycle');
      let project = await Project.init(cwd);
      let workspaces = await project.getWorkspaces();
      let ops = [];

      await project.runWorkspaceTasks(workspaces, async workspace => {
        ops.push('start:' + workspace.pkg.config.getName());
        // wait until next tick
        await Promise.resolve();
        ops.push('end:' + workspace.pkg.config.getName());
      });

      expect(ops).toEqual(['start:bar', 'end:bar', 'start:foo', 'end:foo']);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
