Running a Base node yourself removes the rate limits and third-party dependency of a hosted endpoint, at the cost of operating real infrastructure. Work through this checklist before you point production traffic at your own node.

## Hardware

-   Storage
    -   NVMe SSD, not spinning disk
    -   At least 4 TB free, growing steadily
        -   Snapshot restores need headroom for the archive plus the extracted copy
        -   Monitor free space and alert well before the disk fills
-   Memory
    -   32 GB minimum for a full node
    -   64 GB if you also serve archive queries
-   Network: a symmetric connection with no monthly transfer cap

## Bring-up order

1.  Provision the host and attach storage
2.  Sync the L1 execution and consensus clients
    1.  Start the execution client and wait for it to reach the head
    2.  Start the consensus client and confirm it is following finality
3.  Start op-node and op-geth against the synced L1
4.  Verify the node reports the same block hashes as a public endpoint

## Before serving traffic

-   Health checks wired to your load balancer
-   Alerting on
    -   Peer count dropping to zero
    -   Block height falling behind the public endpoint
