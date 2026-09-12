import json, zipfile, xml.etree.ElementTree as ET
from pathlib import Path
base=Path('tmp/full-audit-acceptance')
evidence=json.loads((base/'backend-evidence.json').read_text(encoding='utf-8-sig'))
result={}
with zipfile.ZipFile(evidence['exports']['docx']) as z:
    names=z.namelist()
    document=z.read('word/document.xml').decode()
    rels=z.read('word/_rels/document.xml.rels').decode() if 'word/_rels/document.xml.rels' in names else ''
    result['docx']={'hasNumberingFile':'word/numbering.xml' in names,'hasListNumberReferences':'<w:numId' in document,'hasDocumentRelationships':bool(rels),'hasNumberingRelationship':'relationships/numbering' in rels,'files':names}
    assert result['docx']['hasNumberingFile'] and result['docx']['hasListNumberReferences'] and result['docx']['hasNumberingRelationship']
with zipfile.ZipFile(evidence['exports']['epub']) as z:
    ns={'o':'http://www.idpf.org/2007/opf'}
    opf=ET.fromstring(z.read('OEBPS/content.opf'))
    manifest={item.attrib['id']:item.attrib['href'] for item in opf.findall('o:manifest/o:item',ns)}
    spine=[manifest[item.attrib['idref']] for item in opf.findall('o:spine/o:itemref',ns)]
    covers=[name for name in spine if 'class="cover"' in z.read('OEBPS/'+name).decode()]
    result['epub']={'spine':spine,'spinePagesContainingCover':covers,'coverCount':len(covers)}
    assert len(covers)==1
(base/'export-evidence.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
