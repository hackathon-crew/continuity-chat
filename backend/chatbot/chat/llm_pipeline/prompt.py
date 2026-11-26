"""按系统常量中的模板名加载提示词。模板文件放在 templates。"""

from pathlib import Path

from chatbot.framework.enums.biz_code import BizCode
from chatbot.framework.exceptions.biz import BizException

_TEMPLATES = Path(__file__).resolve().parent / "templates"


class PromptFactory:
    def load(self, name: str) -> str:
        if not isinstance(name, str) or not name.strip() or Path(name).name != name:
            raise BizException("提示词名称无效", code=BizCode.BAD_REQUEST)
        path = _TEMPLATES / f"{name}.txt"
        if not path.is_file():
            raise BizException("提示词不存在", code=BizCode.NOT_FOUND)
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            raise BizException("提示词为空", code=BizCode.INTERNAL_ERROR)
        return text


prompt_factory = PromptFactory()
