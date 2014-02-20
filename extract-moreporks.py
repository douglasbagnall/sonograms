#!/usr/bin/python

import wave
import os, sys

BPS = 2 * 8000

WAV_DIR = 'static/wav/'


def open_wav(fn):
    w = wave.open(fn, 'w')
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(8000)
    return w


def concat_snippets(src, dest, times):
    #src is a raw file, dest is a wave object
    #because wave objects lack proper seek
    writing = False
    for ss, es in times:
        s = int(ss * 8000) * 2
        e = int(es * 8000) * 2
        src.seek(44 + s)
        audio = src.read(e - s)
        if len(audio) & 1:
            print "truncating %s %s (secs %s)" % (src, len(audio), es)
            audio = audio[:-1]
        dest.writeframes(audio)

def process_line(line, dest=None):
    tokens = line.split()
    fn = tokens.pop(0)
    times = []
    pe = 0
    for i in range(0, len(tokens), 2):
        s = float(tokens[i])
        e = max(float(tokens[i + 1]), pe)
        if s < pe: #overlap
            times[-1][1] = e
        else:
            times.append([s, e])
        pe = e

    if dest is None:
        dest = open_wav(os.path.basename(fn + '-moreporks-only.wav'))
    #print fn, dest
    f = open(WAV_DIR + fn)
    concat_snippets(f, dest, times)
    f.close()

def main(fn):
    dest= open_wav('all-moreporks.wav')
    f = open(fn)
    for line in f:
        process_line(line, dest)

main(sys.argv[1])
