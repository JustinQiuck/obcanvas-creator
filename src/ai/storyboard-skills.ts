import instructions from '../../skills/drama-storyboard/SKILL.md';
import type { StoryboardSkill } from './storyboard-skill';

export const storyboardSkill: StoryboardSkill = {
  id: 'drama-storyboard-preview',
  name: '剧情分镜试点',
  stage: 'storyboard',
  version: 'upstream-4c40ca-adapt-2',
  instructions,
};
