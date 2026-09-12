export type StoryboardSkill = {
  id: string;
  name: string;
  stage: 'storyboard';
  version: string;
  instructions: string;
};

export function storyboardPrompt(skill: StoryboardSkill) {
  return `${skill.instructions.trim()}\n\n宿主输出协议（必须遵守）：\n只输出一个 JSON 对象，不要解释、不要 Markdown 代码块：\n{"shots":[{"title":"镜头名称","evidence":"连续逐字剧本原文","intent":"本镜让观众注意什么、结束时改变什么，以及为什么采用此景别与机位","framing":"景别与构图","camera":"机位、角度与摄影机行为；固定时明确写固定","start":"开拍瞬间已成立的位置、朝向、视线、双手、持物与空间锚点","action":"本镜唯一主要动作或变化","end":"切镜前已达到的可见或可听状态","sound":"对白、环境声、画外声与停顿","keyframePrompt":"只含 start 事实的静态起始关键帧中文提示词","plannedDurationSeconds":4}]}\nshots 最多 60 项。每项所有文字字段都必填且最多 6000 字；title 最多 250 字；evidence 最多 3000 字；plannedDurationSeconds 为大于 0 且不超过 120 的数字。剧本没有可执行内容时返回 {"shots":[]}。`;
}
