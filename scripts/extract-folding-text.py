"""Transient bounded document extraction. Never saves input or calls an AI."""
import sys
import json
import io
import zipfile
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

MAX_TEXT=100000

def extract(kind,data):
    limits=[]
    if kind=="pdf":
        import pymupdf
        with pymupdf.open(stream=data,filetype="pdf") as document:
            if document.needs_pass:
                raise ValueError("Encrypted PDF: provide an unlocked copy.")
            if document.page_count>100:
                raise ValueError("PDF exceeds 100 pages; import an excerpt.")
            chunks=[]
            for page in document:
                chunks.append(page.get_text())
                if sum(map(len,chunks))>MAX_TEXT:
                    raise ValueError("Extracted text exceeds 100,000 characters.")
            text="\n".join(chunks)
        limits.append("PDF text layer only; no OCR, image analysis or formula-layout interpretation.")
    elif kind=="docx":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members=archive.infolist()
            if len(members)>2000 or sum(m.file_size for m in members)>30*1024*1024:
                raise ValueError("DOCX expanded content exceeds the safe size limit.")
            with archive.open("word/document.xml") as member:
                raw=member.read(10*1024*1024+1)
            if len(raw)>10*1024*1024 or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
                raise ValueError("DOCX XML is oversized or contains unsupported declarations.")
            tree=ET.fromstring(raw)
            ns="{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
            paragraphs=[]
            for p in tree.iter(ns+"p"):
                paragraphs.append("".join((node.text or "") if node.tag==ns+"t" else "\t" if node.tag==ns+"tab" else "\n" if node.tag==ns+"br" else "" for node in p.iter()))
            text="\n".join(paragraphs)
        limits.append("DOCX main-body text only; embedded images, headers and formula objects are not interpreted.")
    elif kind in ("txt","md","csv","json","html"):
        encoding="utf-16" if data.startswith((b"\xff\xfe",b"\xfe\xff")) else "utf-8-sig"
        text=data.decode(encoding)
        if "\x00" in text:
            raise ValueError("Binary content is not supported as text.")
        if kind=="html":
            class Text(HTMLParser):
                def __init__(self):
                    super().__init__(convert_charrefs=True)
                    self.parts=[]
                    self.hidden=0
                def handle_starttag(self,tag,attrs):
                    if tag in ("script","style"): self.hidden+=1
                    if tag in ("p","div","br","li","tr","h1","h2","h3") and not self.hidden: self.parts.append("\n")
                def handle_endtag(self,tag):
                    if tag in ("script","style") and self.hidden: self.hidden-=1
                def handle_data(self,value):
                    if not self.hidden: self.parts.append(value)
            parser=Text()
            parser.feed(text)
            text="".join(parser.parts)
            limits.append("HTML text extracted without executing scripts or fetching external resources.")
        else:
            limits.append("Text content only; document numbers and symbols are not automatically financial or physical observations.")
    else:
        raise ValueError("Unsupported document format.")
    text=text.strip()
    if not text:
        raise ValueError("No extractable text. Scanned PDFs and images need OCR before import.")
    if len(text)>MAX_TEXT:
        raise ValueError("Extracted text exceeds 100,000 characters; import an excerpt.")
    return {"text":text,"format":kind,"limitations":limits}

if __name__=="__main__":
    if sys.platform!="win32":
        import resource
        resource.setrlimit(resource.RLIMIT_CPU,(15,15))
        resource.setrlimit(resource.RLIMIT_AS,(2*1024**3,2*1024**3))
    try:
        data=sys.stdin.buffer.read(10*1024*1024+1)
        if not data or len(data)>10*1024*1024:
            raise ValueError("Document must be nonempty and at most 10 MiB.")
        result=extract(sys.argv[1],data)
        print(json.dumps(result,ensure_ascii=True))
    except (ValueError,UnicodeError) as error:
        print(json.dumps({"error":str(error)}))
        sys.exit(1)
    except Exception:
        print(json.dumps({"error":"Document could not be read. Check its format and provide an unlocked, text-bearing file."}))
        sys.exit(1)
