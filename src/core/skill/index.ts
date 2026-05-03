/**
 * Skill 系统模块
 *
 * @module core/skill
 */

export { buildSkillSnapshot, loadSkills, parseFrontmatter, syncBundledSkills } from './loader';
export type {
  Skill,
  SkillConfigEntry,
  SkillEntry,
  SkillFrontmatter,
  SkillLoadConfig,
  SkillSnapshot,
  SkillSource,
} from './types';
