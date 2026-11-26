#!/usr/bin/env python3
"""Build Worm Island into a single self-contained dist/index.html (three.js + postprocessing inlined)."""
import os, sys
here = os.path.dirname(os.path.abspath(__file__))
lib = os.path.join(here, 'lib')
order = ['three.min.js',
 'shaders/CopyShader.js','shaders/LuminosityHighPassShader.js',
 'postprocessing/Pass.js','postprocessing/EffectComposer.js','postprocessing/MaskPass.js',
 'postprocessing/RenderPass.js','postprocessing/ShaderPass.js','postprocessing/UnrealBloomPass.js']
libs = '\n'.join('<script>\n'+open(os.path.join(lib,f),encoding='utf8').read().replace('</script>','<\\/script>')+'\n</script>' for f in order)
html = open(os.path.join(here,'src/index.html'),encoding='utf8').read()
audio = open(os.path.join(here,'src/audio.js'),encoding='utf8').read().replace('</script>','<\\/script>')
feat = open(os.path.join(here,'src/features.js'),encoding='utf8').read().replace('</script>','<\\/script>')
game = open(os.path.join(here,'src/game.js'),encoding='utf8').read().replace('</script>','<\\/script>')
net = open(os.path.join(here,'src/net.js'),encoding='utf8').read().replace('</script>','<\\/script>')
html = html.replace('<!--LIBS-->', libs).replace('<script>/*GAME*/</script>', '<script>\n'+audio+'\n'+game+'\n'+feat+'\n'+net+'\n</script>')
os.makedirs(os.path.join(here,'dist'),exist_ok=True)
out = os.path.join(here,'dist/index.html'); open(out,'w',encoding='utf8').write(html)
print('built', out, round(len(html)/1024), 'KB')
