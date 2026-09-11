import instructions from '../../skills/production-asset-extractor/SKILL.md';
import mvInstructions from '../../skills/mv-asset-extractor/SKILL.md';
import type { AssetSkill } from './skill-model';
export const assetSkill: AssetSkill = { id: 'production-asset-extractor', name: '通用剧情资产', stage: 'assets', version: '1.0.0', instructions };
export const builtinAssetSkills: AssetSkill[] = [assetSkill, { id: 'mv-asset-extractor', name: '音乐 MV 资产', stage: 'assets', version: '1.0.0', instructions: mvInstructions }];
