// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/// @title KnowledgeNFT
/// @notice Each token is an access key to one encrypted course stored on 0G Storage.
/// The content hash (0G Storage root hash) is baked into the token at mint time —
/// anyone can verify on chainscan that this token points to this exact content.
/// Owning the token is what unlocks the AI agent that can answer questions about it.
contract KnowledgeNFT is ERC721Enumerable {
    uint256 private _nextTokenId = 1;

    struct Course {
        uint256 courseId;
        string  contentHash; // 0G Storage root hash of the AES-256 encrypted content
        string  title;
    }

    // tokenId => Course
    mapping(uint256 => Course) public courses;

    event CourseMinted(
        address indexed owner,
        uint256 indexed tokenId,
        uint256 indexed courseId,
        string contentHash
    );

    constructor() ERC721("Knowledge Vault Access", "VAULT") {}

    /// @notice Mint access to a course.
    /// @param courseId      Off-chain course identifier
    /// @param contentHash   Root hash returned by 0G Storage after encrypted upload
    /// @param title         Human-readable course title stored on-chain for transparency
    function mintCourse(
        uint256 courseId,
        string calldata contentHash,
        string calldata title
    ) external returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        courses[tokenId] = Course(courseId, contentHash, title);
        _safeMint(msg.sender, tokenId);
        emit CourseMinted(msg.sender, tokenId, courseId, contentHash);
    }

    /// @notice Does `owner` hold access to `courseId`? Returns (owns, tokenId, contentHash).
    function holdsCourse(address owner, uint256 courseId)
        external view returns (bool, uint256, string memory)
    {
        uint256 balance = balanceOf(owner);
        for (uint256 i = 0; i < balance; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(owner, i);
            if (courses[tokenId].courseId == courseId) {
                return (true, tokenId, courses[tokenId].contentHash);
            }
        }
        return (false, 0, "");
    }

    /// @notice Get the content hash for a specific token (public — content is encrypted).
    function contentHashOf(uint256 tokenId) external view returns (string memory) {
        return courses[tokenId].contentHash;
    }
}
