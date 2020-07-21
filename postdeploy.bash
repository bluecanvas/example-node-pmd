#!/usr/bin/env bash

wget https://github.com/pmd/pmd/releases/download/pmd_releases%2F6.25.0/pmd-bin-6.25.0.zip
unzip pmd-bin-6.25.0.zip
mv pmd-bin-6.25.0 pmd
export PMD_HOME="$PWD/pmd"
