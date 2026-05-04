/**
 * Database dispatcher — public surface for all db operations in the API.
 *
 * Selects the backend at module load time based on PRAETOR_DEV_MODE:
 *   - PRAETOR_DEV_MODE=1  → db-memory.ts  (in-process Maps, no infra needed)
 *   - (default)           → db-supabase.ts (Praetor-native store / real Supabase)
 *
 * The 11 exported function names and signatures are identical in both adapters
 * and must stay that way — every other file in the api package imports from
 * "./db.js" and we never want to touch those import sites.
 *
 * Adding a new db function: add it to both db-memory.ts and db-supabase.ts
 * first, then forward it here.
 */

import { DEV_MODE } from "./env.js";
import * as memory from "./db-memory.js";
import * as supabase from "./db-supabase.js";

// Cache once at module load so every call is a single property lookup.
const impl = DEV_MODE ? memory : supabase;

export const createMissionRow: typeof memory.createMissionRow =
  (input) => impl.createMissionRow(input);

export const updateMissionStatus: typeof memory.updateMissionStatus =
  (id, status) => impl.updateMissionStatus(id, status);

export const appendMissionLog: typeof memory.appendMissionLog =
  (missionId, line) => impl.appendMissionLog(missionId, line);

export const listMissions: typeof memory.listMissions =
  (userId) => impl.listMissions(userId);

export const getMissionForUser: typeof memory.getMissionForUser =
  (missionId, userId) => impl.getMissionForUser(missionId, userId);

export const getMissionLogs: typeof memory.getMissionLogs =
  (missionId) => impl.getMissionLogs(missionId);

export const listInstalledPlugins: typeof memory.listInstalledPlugins =
  (userId) => impl.listInstalledPlugins(userId);

export const installPlugin: typeof memory.installPlugin =
  (userId, pluginName) => impl.installPlugin(userId, pluginName);

export const recordActivityEvent: typeof memory.recordActivityEvent =
  (userId, e) => impl.recordActivityEvent(userId, e);

export const getRecentActivity: typeof memory.getRecentActivity =
  (userId, missionId, limit) => impl.getRecentActivity(userId, missionId, limit);

export const getMissionOwner: typeof memory.getMissionOwner =
  (missionId) => impl.getMissionOwner(missionId);
