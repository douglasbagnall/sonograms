#!/usr/bin/python

import argparse
import json
import wave
import os, sys
from collections import Counter

BPS = 2 * 8000

WAV_DIR = '.'


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

def process_line(line, dest=None, durations=None):
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
    if durations is not None:
        durations.update('%0.2f' % (e - s) for s, e in times)

    #print fn, dest
    f = open(WAV_DIR + fn)
    concat_snippets(f, dest, times)
    f.close()

def process_json_line(line, dest, durations=None, threshold=0.0, margin=0.0):
    tokens = json.loads(line)
    fn = tokens.pop(0)
    times = []
    pe = 0.0
    current_call = [0, 0]
    excluded = 0
    for s, e, intensity in tokens:
        if intensity < threshold:
            excluded += 1
            continue
        s -= margin
        e += margin
        if s <= current_call[1]:
            current_call[1] = e
        else:
            times.append(current_call)
            current_call = [s, e]
    if current_call[1]:
        times.append(current_call)

    if durations is not None:
        durations.update('%0.2f' % (e - s) for s, e in times)

    #print fn, dest
    if times:
        f = open(WAV_DIR + fn)
        concat_snippets(f, dest, times)
        f.close()
    return len(tokens) - excluded, excluded


def main():
    global WAV_DIR
    parser = argparse.ArgumentParser()
    parser.add_argument('-t', '--timings', type=argparse.FileType('r'),
                        help='file from which to read timings')
    parser.add_argument('-d', '--audio-directory', default='.',
                       help='find audio in this directory')
    parser.add_argument('-o', '--output', default='all-moreporks.wav',
                        type=argparse.FileType('w'), help='output file')
    parser.add_argument('-j', '--json', action="store_true",
                        help='timings are in JSON format')
    parser.add_argument('-T', '--threshold', type=float, default=0,
                        help='intensity threshold for call (implies -j)')
    parser.add_argument('-p', '--padding', type=float, default=0,
                        help='margin to add around calls (seconds)')
    parser.add_argument('-r', '--report', action='store_true',
                        help='report call length statistics')
    args = parser.parse_args()
    WAV_DIR = args.audio_directory
    durations = Counter()
    dest = open_wav(args.output)
    if args.json or args.threshold:
        included, excluded = 0, 0
        for line in args.timings:
            calls, ignored = process_json_line(line, dest, durations,
                                               args.threshold, args.padding)
            included += calls
            excluded += ignored
        print "included %d calls" % included
        if args.threshold:
            print "ignored %d calls below threshold %f"  % (excluded, args.threshold)
    else:
        for line in args.timings:
            process_line(line, dest, durations)

    if args.report:
        scale = 90.0 / durations.most_common(1)[0][1]
        for k, v in sorted(durations.items()):
            print "%s %5d %s" % (k, v, '*' * int(scale * v + 0.5))


main()
