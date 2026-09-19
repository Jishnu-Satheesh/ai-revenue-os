from pathlib import Path
p=Path(__file__).resolve().parent
s=(p.parent/'growth-intelligence/prototype.html').read_text()
a=s.index('<section id="panel-insights"');b=s.index('</section>',a)+len('</section>')
s=s[:a]+(p/'workspace-fragment.html').read_text()+s[b:]
s=s.replace('</head>','<style>\n'+(p/'workspace.css').read_text()+'\n'+(p/'report.css').read_text()+'\n</style>\n</head>')
s=s.replace('</body>','<script>\n'+(p/'workspace.js').read_text()+'\n</script><script>\n'+(p/'report.js').read_text()+'\n</script></body>')
s=s.replace('<body>','<body><div id="design-root">').replace('</body>','</div></body>')
s=s.replace('Growth Intelligence · design review','Market Watch · Design review')
s=s.replace('Illustrative data','Fictional examples')
(p/'prototype.html').write_text(s)
print('Assembled review prototype:',len(s.encode()),'bytes')
