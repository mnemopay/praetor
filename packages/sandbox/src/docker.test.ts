import { describe, it, expect, vi } from "vitest";
import { DockerSandboxFactory, type DockerSandboxOptions } from "./docker.js";

/**
 * The Docker adapter shells out to `docker`. Real Docker isn't always
 * available on the test runner, so we drive every spawn through a stub
 * (`__spawn`). Each call records its argv + stdin so tests assert what
 * the adapter sends to the daemon.
 */
function fakeSpawn(initial: { stdout?: string; stderr?: string; exitCode?: number } = {}): {
  fn: NonNullable<DockerSandboxOptions["__spawn"]>;
  calls: { args: string[]; stdin?: string | Buffer }[];
  setNext: (resp: { stdout?: string; stderr?: string; exitCode?: number }) => void;
} {
  const calls: { args: string[]; stdin?: string | Buffer }[] = [];
  const queue: { stdout?: string; stderr?: string; exitCode?: number }[] = [];
  return {
    calls,
    setNext: (resp) => { queue.push(resp); },
    fn: async (args, stdin) => {
      calls.push({ args, stdin });
      const next = queue.shift() ?? initial;
      return {
        stdout: next.stdout ?? "",
        stderr: next.stderr ?? "",
        exitCode: next.exitCode ?? 0,
      };
    },
  };
}

describe("DockerSandboxFactory.create", () => {
  it("issues `docker run -d --rm` with hardening defaults + workdir/env/mounts and returns a sandbox", async () => {
    const spawn = fakeSpawn();
    spawn.setNext({ stdout: "abc123def456789\n", exitCode: 0 }); // run
    spawn.setNext({ exitCode: 0 }); // mkdir -p workdir
    const factory = new DockerSandboxFactory({
      image: "node:20-alpine",
      workdir: "/work",
      mounts: [{ host: "/repo", container: "/work", readonly: false }],
      env: { FOO: "bar" },
      __spawn: spawn.fn,
    });
    const sb = await factory.create();
    expect(sb.id.startsWith("abc123def456")).toBe(true);
    const runCall = spawn.calls[0].args;
    expect(runCall[0]).toBe("run");
    expect(runCall).toContain("-d");
    expect(runCall).toContain("--rm");
    expect(runCall).toContain("-w");
    expect(runCall).toContain("/work");
    expect(runCall.some((a) => a === "/repo:/work")).toBe(true);
    expect(runCall).toContain("-e");
    expect(runCall).toContain("FOO=bar");
    expect(runCall.includes("node:20-alpine")).toBe(true);
    expect(runCall.slice(-2)).toEqual(["sleep", "infinity"]);

    // Hardening defaults must be present.
    expect(runCall).toContain("--memory");
    expect(runCall).toContain("2g");
    expect(runCall).toContain("--cpus");
    expect(runCall).toContain("--pids-limit");
    expect(runCall).toContain("--security-opt");
    expect(runCall).toContain("no-new-privileges");
    expect(runCall).toContain("--cap-drop");
    expect(runCall).toContain("ALL");
    expect(runCall).toContain("--read-only");
    expect(runCall).toContain("--tmpfs");
    expect(runCall).toContain("--network");
    expect(runCall).toContain("bridge");
  });

  it("refuses dangerous mounts (e.g. /, /var/run/docker.sock) by default", async () => {
    const spawn = fakeSpawn();
    const factory = new DockerSandboxFactory({
      mounts: [{ host: "/var/run/docker.sock", container: "/var/run/docker.sock" }],
      __spawn: spawn.fn,
    });
    await expect(factory.create()).rejects.toThrow(/refusing dangerous mount.*docker\.sock/);
  });

  it("refuseDangerousMounts: false lets the caller opt back in (sovereign-mode escape hatch)", async () => {
    const spawn = fakeSpawn();
    spawn.setNext({ stdout: "cid\n", exitCode: 0 });
    spawn.setNext({ exitCode: 0 });
    const factory = new DockerSandboxFactory({
      mounts: [{ host: "/var/run/docker.sock", container: "/var/run/docker.sock" }],
      refuseDangerousMounts: false,
      __spawn: spawn.fn,
    });
    await expect(factory.create()).resolves.toBeDefined();
  });

  it("limits=null disables individual hardening defaults", async () => {
    const spawn = fakeSpawn();
    spawn.setNext({ stdout: "cid\n", exitCode: 0 });
    spawn.setNext({ exitCode: 0 });
    const factory = new DockerSandboxFactory({
      __spawn: spawn.fn,
      limits: { memory: null, cpus: null, readOnlyRootFs: false, dropAllCaps: false },
    });
    await factory.create();
    const runCall = spawn.calls[0].args;
    expect(runCall.includes("--memory")).toBe(false);
    expect(runCall.includes("--cpus")).toBe(false);
    expect(runCall.includes("--read-only")).toBe(false);
    expect(runCall.includes("--cap-drop")).toBe(false);
  });

  it("surfaces a clear error when docker run exits non-zero", async () => {
    const spawn = fakeSpawn();
    spawn.setNext({ exitCode: 125, stderr: "Error: image not found" });
    const factory = new DockerSandboxFactory({ image: "ghost:latest", __spawn: spawn.fn });
    await expect(factory.create()).rejects.toThrow(/'docker run' failed.*image not found/);
  });

  it("isAvailable returns true when `docker version` succeeds", async () => {
    const spawn = fakeSpawn();
    spawn.setNext({ stdout: "24.0.7", exitCode: 0 });
    const ok = await DockerSandboxFactory.isAvailable({ __spawn: spawn.fn });
    expect(ok).toBe(true);
  });

  it("isAvailable returns false on docker errors / missing binary", async () => {
    const spawn = fakeSpawn();
    spawn.setNext({ exitCode: -1, stderr: "ENOENT" });
    expect(await DockerSandboxFactory.isAvailable({ __spawn: spawn.fn })).toBe(false);
  });
});

describe("DockerSandbox — exec / writeFile / readFile / close", () => {
  it("exec passes -w cwd, -e env, then sh -c <cmd> to the running container", async () => {
    const spawn = fakeSpawn();
    spawn.setNext({ stdout: "abc123def\n", exitCode: 0 }); // run
    spawn.setNext({ exitCode: 0 }); // mkdir
    spawn.setNext({ stdout: "ok\n", exitCode: 0 }); // exec
    const factory = new DockerSandboxFactory({ __spawn: spawn.fn });
    const sb = await factory.create();
    const r = await sb.exec("echo ok", { cwd: "/tmp", env: { K: "v" }, timeoutMs: 5000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("ok");
    const execCall = spawn.calls[2].args;
    expect(execCall[0]).toBe("exec");
    expect(execCall).toContain("-w");
    expect(execCall).toContain("/tmp");
    expect(execCall).toContain("-e");
    expect(execCall).toContain("K=v");
    expect(execCall.slice(-3)).toEqual(["sh", "-c", "echo ok"]);
  });

  it("writeFile mkdirs the parent then pipes content through `tee` argv-style (no shell)", async () => {
    const spawn = fakeSpawn();
    spawn.setNext({ stdout: "cid12345\n", exitCode: 0 }); // run
    spawn.setNext({ exitCode: 0 }); // initial mkdir for workdir
    spawn.setNext({ exitCode: 0 }); // mkdir parent
    spawn.setNext({ exitCode: 0 }); // exec -i ... tee path
    const sb = await new DockerSandboxFactory({ __spawn: spawn.fn }).create();
    await sb.writeFile("/work/foo/bar.txt", "praetor smoke");
    const mkdirCall = spawn.calls[2].args;
    expect(mkdirCall[0]).toBe("exec");
    expect(mkdirCall).toContain("-p");
    expect(mkdirCall).toContain("/work/foo");
    const writeCall = spawn.calls[3];
    expect(writeCall.args).toContain("-i");
    // tee + path passed as argv args, never through a shell.
    expect(writeCall.args.slice(-2)).toEqual(["tee", "/work/foo/bar.txt"]);
    expect(writeCall.args.includes("sh")).toBe(false);
    expect(writeCall.stdin instanceof Buffer ? writeCall.stdin.toString("utf8") : writeCall.stdin).toBe("praetor smoke");
  });

  it("writeFile is safe against crafted paths — no shell injection", async () => {
    const spawn = fakeSpawn();
    spawn.setNext({ stdout: "cid\n", exitCode: 0 });
    spawn.setNext({ exitCode: 0 });
    spawn.setNext({ exitCode: 0 });
    spawn.setNext({ exitCode: 0 });
    const sb = await new DockerSandboxFactory({ __spawn: spawn.fn }).create();
    const evil = "/work/$(rm -rf /); echo pwned`whoami`.txt";
    await sb.writeFile(evil, "x");
    const writeCall = spawn.calls[spawn.calls.length - 1];
    // The crafted path must appear as a single argv argument, untransformed —
    // a shell would expand $() and backticks, but argv-style means tee just
    // tries to open a literal file with that exact name.
    expect(writeCall.args[writeCall.args.length - 1]).toBe(evil);
  });

  it("readFile returns docker exec stdout", async () => {
    const spawn = fakeSpawn();
    spawn.setNext({ stdout: "cid\n", exitCode: 0 }); // run
    spawn.setNext({ exitCode: 0 }); // mkdir workdir
    spawn.setNext({ stdout: "hello world", exitCode: 0 }); // exec cat
    const sb = await new DockerSandboxFactory({ __spawn: spawn.fn }).create();
    const r = await sb.readFile("/work/x.txt");
    expect(r).toBe("hello world");
    const catCall = spawn.calls[2].args;
    expect(catCall.slice(-2)).toEqual(["cat", "/work/x.txt"]);
  });

  it("close runs `docker rm -f`", async () => {
    const spawn = fakeSpawn();
    spawn.setNext({ stdout: "cid\n", exitCode: 0 });
    spawn.setNext({ exitCode: 0 });
    spawn.setNext({ exitCode: 0 });
    const sb = await new DockerSandboxFactory({ __spawn: spawn.fn }).create();
    await sb.close();
    const rmCall = spawn.calls[2].args;
    expect(rmCall[0]).toBe("rm");
    expect(rmCall).toContain("-f");
  });
});
