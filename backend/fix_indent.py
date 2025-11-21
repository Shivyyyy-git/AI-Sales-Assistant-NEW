#!/usr/bin/env python3
# Quick script to fix the indentation issue

with open('community_filter_engine_enhanced.py', 'r') as f:
    lines = f.readlines()

# Fix lines 159-162 (0-indexed: 158-161)
for i in range(158, 162):
    if lines[i].startswith('        print'):
        lines[i] = '    ' + lines[i]  # Add 4 more spaces

with open('community_filter_engine_enhanced.py', 'w') as f:
    f.writelines(lines)

print("Fixed indentation")

